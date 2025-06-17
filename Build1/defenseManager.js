/**
 * Defense Manager - Handles hostile detection and defense coordination
 * Optimized for CPU efficiency and resiliency
 */
const utils = require('utils');

const defenseManager = {
    /**
     * Run defense manager for a room
     * @param {Room} room - The room to manage defense for
     */
    run: function(room) {
        // Skip if we don't own the controller
        if (!room.controller || !room.controller.my) return;
        
        // Check for hostiles - this is a critical operation
        const hostiles = this.getHostiles(room);
        
        // Update room memory with hostile information
        room.memory.defense = room.memory.defense || {};
        room.memory.defense.hostileCount = hostiles.length;
        room.memory.defense.lastHostileCheck = Game.time;
        
        // If no hostiles, nothing more to do
        if (hostiles.length === 0) {
            if (room.memory.defense.threatLevel) {
                console.log(`Room ${room.name} is now safe.`);
                room.memory.defense.threatLevel = 0;
            }
            return;
        }
        
        // Assess threat level
        const threatLevel = this.assessThreatLevel(hostiles);
        room.memory.defense.threatLevel = threatLevel;
        
        // Handle defense based on threat level
        if (threatLevel >= 4) {
            // Critical threat - activate emergency mode
            if (!global.emergencyMode || global.emergencyMode.level !== 'critical') {
                global.emergencyMode = {
                    active: true,
                    startTime: Game.time,
                    level: 'critical',
                    reason: 'invasion'
                };
                console.log(`⚠️ CRITICAL THREAT in ${room.name}: Activating emergency protocols!`);
            }
        } else if (threatLevel >= 2) {
            // Significant threat - activate high emergency if not already in critical
            if (!global.emergencyMode || global.emergencyMode.level === 'off') {
                global.emergencyMode = {
                    active: true,
                    startTime: Game.time,
                    level: 'high',
                    reason: 'invasion'
                };
                console.log(`⚠️ HIGH THREAT in ${room.name}: Activating defense protocols!`);
            }
        }
        
        // Activate towers
        this.activateTowers(room, hostiles);
        
        // Alert nearby rooms if needed
        if (threatLevel >= 3 && Game.time % 10 === 0) {
            this.alertNearbyRooms(room);
        }
    },
    
    /**
     * Get hostile entities in the room
     * @param {Room} room - The room to check
     * @returns {Array} - Array of hostile creeps
     */
    getHostiles: function(room) {
        return room.find(FIND_HOSTILE_CREEPS);
    },
    
    /**
     * Assess threat level based on hostile creeps
     * @param {Array} hostiles - Array of hostile creeps
     * @returns {number} - Threat level (0-5)
     */
    assessThreatLevel: function(hostiles) {
        if (hostiles.length === 0) return 0;
        
        let threatLevel = 1; // Base threat level
        let totalAttackParts = 0;
        let totalHealParts = 0;
        let totalRangedParts = 0;
        let totalWorkParts = 0; // For dismantling
        
        // Count dangerous body parts
        for (const hostile of hostiles) {
            for (const part of hostile.body) {
                if (part.type === ATTACK) totalAttackParts++;
                if (part.type === RANGED_ATTACK) totalRangedParts++;
                if (part.type === HEAL) totalHealParts++;
                if (part.type === WORK) totalWorkParts++;
            }
        }
        
        // Adjust threat level based on body parts
        if (totalAttackParts + totalRangedParts > 10) threatLevel = Math.max(threatLevel, 4);
        else if (totalAttackParts + totalRangedParts > 5) threatLevel = Math.max(threatLevel, 3);
        else if (totalAttackParts + totalRangedParts > 0) threatLevel = Math.max(threatLevel, 2);
        
        // Healers make threats more dangerous
        if (totalHealParts > 5) threatLevel++;
        
        // Work parts could be used for dismantling
        if (totalWorkParts > 10) threatLevel = Math.max(threatLevel, 3);
        
        // Cap at level 5
        return Math.min(threatLevel, 5);
    },
    
    /**
     * Activate towers to defend against hostiles
     * @param {Room} room - The room to defend
     * @param {Array} hostiles - Array of hostile creeps
     */
    activateTowers: function(room, hostiles) {
        if (hostiles.length === 0) return;
        
        const towers = room.find(FIND_MY_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_TOWER
        });
        
        if (towers.length === 0) return;
        
        // Sort hostiles by priority
        hostiles.sort((a, b) => {
            // Prioritize creeps with healing parts
            const aHasHeal = a.body.some(part => part.type === HEAL);
            const bHasHeal = b.body.some(part => part.type === HEAL);
            
            if (aHasHeal && !bHasHeal) return -1;
            if (!aHasHeal && bHasHeal) return 1;
            
            // Then prioritize creeps with attack parts
            const aHasAttack = a.body.some(part => part.type === ATTACK || part.type === RANGED_ATTACK);
            const bHasAttack = b.body.some(part => part.type === ATTACK || part.type === RANGED_ATTACK);
            
            if (aHasAttack && !bHasAttack) return -1;
            if (!aHasAttack && bHasAttack) return 1;
            
            // Finally sort by distance to spawn
            const spawn = room.find(FIND_MY_SPAWNS)[0];
            if (spawn) {
                return a.pos.getRangeTo(spawn) - b.pos.getRangeTo(spawn);
            }
            
            return 0;
        });
        
        // Attack the highest priority target with all towers
        const target = hostiles[0];
        for (const tower of towers) {
            tower.attack(target);
        }
    },
    
    /**
     * Alert nearby rooms about invasion
     * @param {Room} room - The room under attack
     */
    alertNearbyRooms: function(room) {
        // This would be expanded in a multi-room setup
        console.log(`⚠️ ALERT: Room ${room.name} under attack! Threat level: ${room.memory.defense.threatLevel}`);
    }
};

module.exports = defenseManager;