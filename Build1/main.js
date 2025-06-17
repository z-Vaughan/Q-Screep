/**
 * Main game loop - CPU optimized
 */
const roleHarvester = require('role.harvester');
const roleUpgrader = require('role.upgrader');
const roleBuilder = require('role.builder');
const roleHauler = require('role.hauler');
const roomManager = require('roomManager');
const spawnManager = require('spawnManager');
const constructionManager = require('constructionManager');
const utils = require('utils');

// Global performance tracking
global.stats = {
    cpu: {
        total: 0,
        roomManagement: 0,
        creepActions: 0,
        spawning: 0,
        construction: 0,
        memoryCleanup: 0,
        ticks: 0
    }
};

// Global utility functions
global.utils = utils;

module.exports.loop = function() {
    // Start CPU tracking
    const cpuStart = Game.cpu.getUsed();
    const currentTick = Game.time;
    
    // Memory cleanup - only run every 20 ticks to save CPU
    if (currentTick % 20 === 0) {
        const memStart = Game.cpu.getUsed();
        for (const name in Memory.creeps) {
            if (!Game.creeps[name]) {
                delete Memory.creeps[name];
            }
        }
        global.stats.cpu.memoryCleanup = Game.cpu.getUsed() - memStart;
    }
    
    // Process each room we control
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        
        // Skip rooms we don't own
        if (!room.controller || !room.controller.my) continue;
        
        // Update room intelligence once per tick
        const roomStart = Game.cpu.getUsed();
        roomManager.updateRoomData(room);
        global.stats.cpu.roomManagement += Game.cpu.getUsed() - roomStart;
        
        // Handle spawning logic - throttle based on available CPU
        if (Game.cpu.bucket > 3000 || currentTick % 3 === 0) {
            const spawnStart = Game.cpu.getUsed();
            spawnManager.run(room);
            global.stats.cpu.spawning += Game.cpu.getUsed() - spawnStart;
        }
        
        // Handle construction planning - run less frequently
        if (Game.cpu.bucket > 3000) {
            const constructionStart = Game.cpu.getUsed();
            constructionManager.run(room);
            global.stats.cpu.construction += Game.cpu.getUsed() - constructionStart;
        }
    }
    
    // Process creeps by type for better CPU batching
    const creepStart = Game.cpu.getUsed();
    
    // Group creeps by role for more efficient processing
    const creepsByRole = {
        harvester: [],
        hauler: [],
        upgrader: [],
        builder: []
    };
    
    // Sort creeps by role
    for (const name in Game.creeps) {
        const creep = Game.creeps[name];
        if (creepsByRole[creep.memory.role]) {
            creepsByRole[creep.memory.role].push(creep);
        }
    }
    
    // Process creeps by role - this allows for better CPU batching
    // Process harvesters first as they're the foundation of the economy
    for (const harvester of creepsByRole.harvester) {
        roleHarvester.run(harvester);
    }
    
    // Process haulers next to move the energy
    for (const hauler of creepsByRole.hauler) {
        roleHauler.run(hauler);
    }
    
    // Process upgraders to maintain controller level
    for (const upgrader of creepsByRole.upgrader) {
        roleUpgrader.run(upgrader);
    }
    
    // Process builders last as they're less critical
    for (const builder of creepsByRole.builder) {
        roleBuilder.run(builder);
    }
    
    global.stats.cpu.creepActions = Game.cpu.getUsed() - creepStart;
    
    // Update CPU statistics
    global.stats.cpu.total = Game.cpu.getUsed() - cpuStart;
    global.stats.cpu.ticks++;
    
    // Log performance stats every 100 ticks
    if (currentTick % 100 === 0) {
        utils.logCPUStats({
            total: global.stats.cpu.total / global.stats.cpu.ticks,
            roomManagement: global.stats.cpu.roomManagement / global.stats.cpu.ticks,
            creepActions: global.stats.cpu.creepActions / global.stats.cpu.ticks,
            spawning: global.stats.cpu.spawning / global.stats.cpu.ticks,
            construction: global.stats.cpu.construction / global.stats.cpu.ticks,
            memoryCleanup: global.stats.cpu.memoryCleanup / global.stats.cpu.ticks
        });
            
        // Reset stats
        for (const key in global.stats.cpu) {
            if (key !== 'ticks') {
                global.stats.cpu[key] = 0;
            }
        }
        
        // Clear caches periodically to prevent memory leaks
        utils.clearCache();
        spawnManager.resetCache();
    }
};