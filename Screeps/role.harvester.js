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
        // If creep is dying, release its source
        if (creep.ticksToLive < 30 && creep.memory.sourceId) {
            roomManager.releaseSource(creep.memory.sourceId, creep.memory.homeRoom);
            creep.memory.sourceId = null;
        }
        
        // If creep doesn't have a source assigned, get one
        if (!creep.memory.sourceId) {
            const source = roomManager.getBestSource(creep.room);
            if (source) {
                creep.memory.sourceId = source.id;
                // Cache the source position to avoid pathfinding
                creep.memory.sourcePos = {x: source.pos.x, y: source.pos.y, roomName: source.pos.roomName};
            } else {
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
                        creep.moveTo(new RoomPosition(
                            creep.memory.idlePos.x,
                            creep.memory.idlePos.y,
                            creep.memory.idlePos.roomName
                        ), { reusePath: 20 });
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