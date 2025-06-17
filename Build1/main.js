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
const defenseManager = require('defenseManager');
const remoteManager = require('remoteManager');
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

// Global error handler
const errorHandler = function(error) {
    console.log(`UNCAUGHT EXCEPTION: ${error.stack || error}`);
    
    // Activate emergency mode
    global.emergencyMode = {
        active: true,
        startTime: Game.time,
        level: 'critical',
        reason: 'uncaught_exception'
    };
};

module.exports.loop = function() {
    try {
    // Start CPU tracking
    const cpuStart = Game.cpu.getUsed();
    const currentTick = Game.time;
    
    // Memory cleanup and validation - only run every 20 ticks to save CPU
    if (currentTick % 20 === 0) {
        const memStart = Game.cpu.getUsed();
        
        // Clean up dead creeps from memory
        for (const name in Memory.creeps) {
            if (!Game.creeps[name]) {
                // If creep had a source assigned, release it
                if (Memory.creeps[name].sourceId && Memory.creeps[name].homeRoom) {
                    try {
                        roomManager.releaseSource(Memory.creeps[name].sourceId, Memory.creeps[name].homeRoom);
                    } catch (e) {
                        console.log(`Error releasing source for dead creep ${name}: ${e}`);
                    }
                }
                delete Memory.creeps[name];
            }
        }
        
        // Validate room memory structure
        for (const roomName in Memory.rooms) {
            if (!Game.rooms[roomName] || !Game.rooms[roomName].controller || !Game.rooms[roomName].controller.my) {
                // Room is not visible or not owned, keep minimal data
                if (Memory.rooms[roomName]) {
                    const reservationStatus = Memory.rooms[roomName].reservation;
                    Memory.rooms[roomName] = { 
                        lastSeen: Game.time,
                        reservation: reservationStatus
                    };
                }
            } else {
                // Ensure critical memory structures exist
                if (!Memory.rooms[roomName].sources) Memory.rooms[roomName].sources = {};
                if (!Memory.rooms[roomName].construction) {
                    Memory.rooms[roomName].construction = {
                        roads: { planned: false },
                        extensions: { planned: false, count: 0 },
                        lastUpdate: 0
                    };
                }
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
        
        // Run defense manager - this is critical for survival
        try {
            const defenseStart = Game.cpu.getUsed();
            defenseManager.run(room);
            
            // Track defense CPU usage
            if (!global.stats.cpu.defense) global.stats.cpu.defense = 0;
            global.stats.cpu.defense += Game.cpu.getUsed() - defenseStart;
        } catch (error) {
            console.log(`Error in defenseManager for room ${room.name}: ${error}`);
        }
        
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
    
    // Run remote operations manager if CPU allows
    if (utils.shouldExecute('low')) {
        try {
            remoteManager.run();
        } catch (error) {
            console.log(`Error in remoteManager: ${error}`);
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
    const utils = require('utils');
    
    // In emergency mode, process fewer creeps per tick
    const processCreepRole = function(creeps, roleFunction, priority) {
        // Skip non-critical roles in critical emergency mode
        if (global.emergencyMode && 
            global.emergencyMode.level === 'critical' && 
            priority !== 'critical') {
            return;
        }
        
        // Skip low priority roles when CPU is constrained
        if (!utils.shouldExecute(priority)) return;
        
        // In emergency mode, process only a subset of creeps
        let creepsToProcess = creeps;
        if (global.emergencyMode && creeps.length > 3) {
            // Process only 1/3 of creeps each tick in emergency mode
            const startIdx = Game.time % 3;
            creepsToProcess = creeps.filter((_, idx) => idx % 3 === startIdx);
        }
        
        // Process the creeps with error handling
        for (const creep of creepsToProcess) {
            try {
                roleFunction.run(creep);
            } catch (error) {
                console.log(`Error running ${creep.memory.role} ${creep.name}: ${error}`);
                // Basic fallback behavior - move to spawn if error
                if (Game.time % 10 === 0) { // Only try occasionally to save CPU
                    const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
                    if (spawn) creep.moveTo(spawn);
                }
            }
        }
    };
    
    // Process harvesters first as they're the foundation of the economy
    processCreepRole(creepsByRole.harvester, roleHarvester, 'critical');
    
    // Process haulers next to move the energy
    processCreepRole(creepsByRole.hauler, roleHauler, 'high');
    
    // Process upgraders to maintain controller level
    processCreepRole(creepsByRole.upgrader, roleUpgrader, 'medium');
    
    // Process builders last as they're less critical
    processCreepRole(creepsByRole.builder, roleBuilder, 'low');
    
    global.stats.cpu.creepActions = Game.cpu.getUsed() - creepStart;
    
    // Update CPU statistics
    const totalCpuUsed = Game.cpu.getUsed() - cpuStart;
    global.stats.cpu.total = totalCpuUsed;
    global.stats.cpu.ticks++;
    
    // CPU emergency recovery mode
    const cpuLimit = Game.cpu.limit || 20;
    const cpuPercentage = totalCpuUsed / cpuLimit;
    
    // Track CPU usage trend
    if (!global.cpuHistory) global.cpuHistory = [];
    global.cpuHistory.push(cpuPercentage);
    if (global.cpuHistory.length > 10) global.cpuHistory.shift();
    
    // Calculate average CPU usage over last 10 ticks
    const avgCpuUsage = global.cpuHistory.reduce((sum, val) => sum + val, 0) / global.cpuHistory.length;
    
    // Enter emergency mode if CPU usage is consistently high or bucket is critically low
    if (avgCpuUsage > 0.9 || Game.cpu.bucket < 1000) {
        if (!global.emergencyMode) {
            global.emergencyMode = {
                active: true,
                startTime: Game.time,
                level: Game.cpu.bucket < 500 ? 'critical' : 'high'
            };
            console.log(`⚠️ ENTERING EMERGENCY CPU MODE (${global.emergencyMode.level}): CPU usage ${(avgCpuUsage*100).toFixed(1)}%, bucket ${Game.cpu.bucket}`);
        }
    } else if (global.emergencyMode && (avgCpuUsage < 0.7 && Game.cpu.bucket > 3000)) {
        console.log(`✓ Exiting emergency CPU mode after ${Game.time - global.emergencyMode.startTime} ticks`);
        global.emergencyMode = null;
    }
    
    // Log performance stats every 100 ticks
    if (currentTick % 100 === 0) {
        utils.logCPUStats({
            total: global.stats.cpu.total / global.stats.cpu.ticks,
            roomManagement: global.stats.cpu.roomManagement / global.stats.cpu.ticks,
            creepActions: global.stats.cpu.creepActions / global.stats.cpu.ticks,
            spawning: global.stats.cpu.spawning / global.stats.cpu.ticks,
            construction: global.stats.cpu.construction / global.stats.cpu.ticks,
            defense: (global.stats.cpu.defense || 0) / global.stats.cpu.ticks,
            memoryCleanup: global.stats.cpu.memoryCleanup / global.stats.cpu.ticks,
            emergencyMode: global.emergencyMode ? global.emergencyMode.level : 'off',
            bucket: Game.cpu.bucket
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
    } catch (error) {
        errorHandler(error);
    }
};