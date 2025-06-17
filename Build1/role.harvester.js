/**
 * Harvester Role - Static source mining
 * CPU optimized for maximum efficiency
 */
const roomManager = require('roomManager');

const roleHarvester = {
    /**
     * Run the harvester role
     * @param {Creep} creep - The creep to run the role for
     */
    run: function(creep) {
        const utils = require('utils');
        
        // If creep is dying, release its source
        if (creep.ticksToLive < 30 && creep.memory.sourceId) {
            try {
                roomManager.releaseSource(creep.memory.sourceId, creep.memory.homeRoom);
            } catch (e) {
                utils.logError(`harvester_release_${creep.name}`, `Failed to release source: ${e}`, 50);
            }
            creep.memory.sourceId = null;
        }
        
        // Periodic source validation - check every 50 ticks if source still exists
        if (creep.memory.sourceId && Game.time % 50 === 0) {
            const source = Game.getObjectById(creep.memory.sourceId);
            if (!source) {
                utils.logError(`harvester_invalid_source_${creep.name}`, 
                    `Source ${creep.memory.sourceId} no longer exists, reassigning`, 100);
                creep.memory.sourceId = null;
            }
        }
        
        // If creep doesn't have a source assigned, get one
        if (!creep.memory.sourceId) {
            // Try to get a source from room manager
            let source = null;
            try {
                source = roomManager.getBestSource(creep.room);
            } catch (e) {
                utils.logError(`harvester_getsource_${creep.name}`, `Failed to get source: ${e}`, 50);
            }
            
            if (source) {
                creep.memory.sourceId = source.id;
                // Cache the source position to avoid pathfinding
                creep.memory.sourcePos = {x: source.pos.x, y: source.pos.y, roomName: source.pos.roomName};
                
                // Reset container cache when source changes
                creep.memory.containerId = null;
            } else {
                // Fallback: try to find any source if room manager failed
                if (!source && Game.time % 10 === 0) { // Only try occasionally to save CPU
                    const sources = creep.room.find(FIND_SOURCES);
                    if (sources.length > 0) {
                        source = sources[0];
                        creep.memory.sourceId = source.id;
                        creep.memory.sourcePos = {x: source.pos.x, y: source.pos.y, roomName: source.pos.roomName};
                        utils.logError(`harvester_fallback_${creep.name}`, 
                            `Using fallback source assignment: ${source.id}`, 100);
                    }
                }
                
                // No available source, try to help with other tasks
                if (creep.store[RESOURCE_ENERGY] > 0) {
                    this.deliverEnergy(creep);
                } else {
                    // Move to a waiting area near spawn
                    if (!creep.memory.idlePos) {
                        const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
                        if (spawn) {
                            creep.memory.idlePos = {x: spawn.pos.x + 3, y: spawn.pos.y, roomName: spawn.pos.roomName};
                        }
                    }
                    
                    if (creep.memory.idlePos) {
                        try {
                            creep.moveTo(new RoomPosition(
                                creep.memory.idlePos.x,
                                creep.memory.idlePos.y,
                                creep.memory.idlePos.roomName
                            ), { reusePath: 20 });
                        } catch (e) {
                            // If movement fails, try to move to spawn directly
                            const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
                            if (spawn) creep.moveTo(spawn);
                        }
                    }
                }
                return;
            }
        }
        
        // Get the assigned source
        const source = Game.getObjectById(creep.memory.sourceId);
        if (!source) {
            creep.memory.sourceId = null;
            return;
        }
        
        // Cache container near source
        if (!creep.memory.containerId && creep.store.getFreeCapacity() === 0) {
            const containers = source.pos.findInRange(FIND_STRUCTURES, 1, {
                filter: s => s.structureType === STRUCTURE_CONTAINER
            });
            
            if (containers.length > 0) {
                creep.memory.containerId = containers[0].id;
            } else {
                creep.memory.containerId = 'none';
            }
        }
        
        // If creep is full, drop energy or transfer to nearby container/link
        if (creep.store.getFreeCapacity() === 0) {
            if (creep.memory.containerId && creep.memory.containerId !== 'none') {
                const container = Game.getObjectById(creep.memory.containerId);
                if (container) {
                    if (creep.transfer(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                        creep.moveTo(container, { reusePath: 5 });
                    }
                } else {
                    // Container was destroyed, reset cache
                    creep.memory.containerId = null;
                    creep.drop(RESOURCE_ENERGY);
                }
            } else {
                // Drop energy for haulers to pick up
                creep.drop(RESOURCE_ENERGY);
            }
            return;
        }
        
        // Move to source and harvest
        const harvestResult = creep.harvest(source);
        if (harvestResult === ERR_NOT_IN_RANGE) {
            // Use cached position if available
            if (creep.memory.sourcePos) {
                creep.moveTo(
                    new RoomPosition(
                        creep.memory.sourcePos.x,
                        creep.memory.sourcePos.y,
                        creep.memory.sourcePos.roomName
                    ),
                    { reusePath: 30 } // Reuse path for longer since harvesters are static
                );
            } else {
                creep.moveTo(source, { reusePath: 30 });
            }
        }
    },
    
    /**
     * Deliver energy to structures when no source is available
     * @param {Creep} creep - The creep to deliver energy
     */
    deliverEnergy: function(creep) {
        // Use cached target if available
        let target = creep.memory.deliveryTargetId ? Game.getObjectById(creep.memory.deliveryTargetId) : null;
        
        // Validate target still needs energy
        if (!target || (target.store && target.store.getFreeCapacity(RESOURCE_ENERGY) === 0)) {
            // Use room's cached energy structures if available
            const energyStructures = roomManager.getRoomData(creep.room.name, 'energyStructures');
            
            if (energyStructures) {
                for (const id of energyStructures) {
                    const structure = Game.getObjectById(id);
                    if (structure && structure.store && structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
                        target = structure;
                        creep.memory.deliveryTargetId = id;
                        break;
                    }
                }
            } else {
                // Fallback to finding closest structure
                target = creep.pos.findClosestByPath(FIND_STRUCTURES, {
                    filter: s => (
                        (s.structureType === STRUCTURE_EXTENSION || 
                         s.structureType === STRUCTURE_SPAWN || 
                         s.structureType === STRUCTURE_TOWER) && 
                        s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
                    )
                });
                
                if (target) {
                    creep.memory.deliveryTargetId = target.id;
                }
            }
        }
        
        if (target) {
            if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                creep.moveTo(target, { reusePath: 10 });
            }
        } else {
            // If no structures need energy, upgrade controller
            if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
                creep.moveTo(creep.room.controller, { reusePath: 10 });
            }
        }
    }
};

module.exports = roleHarvester;