/**
 * Upgrader Role - Controller upgrading
 * CPU optimized for maximum efficiency
 */
const roleUpgrader = {
    /**
     * Run the upgrader role
     * @param {Creep} creep - The creep to run the role for
     */
    run: function(creep) {
        // State switching with minimal operations
        if (creep.memory.upgrading && creep.store[RESOURCE_ENERGY] === 0) {
            creep.memory.upgrading = false;
            // Clear target cache when switching states
            delete creep.memory.energySourceId;
        }
        if (!creep.memory.upgrading && creep.store.getFreeCapacity() === 0) {
            creep.memory.upgrading = true;
            // Cache controller position when switching to upgrading
            if (!creep.memory.controllerPos) {
                creep.memory.controllerPos = {
                    x: creep.room.controller.pos.x,
                    y: creep.room.controller.pos.y,
                    roomName: creep.room.name
                };
            }
        }
        
        if (creep.memory.upgrading) {
            // Upgrade the controller using cached position
            const upgradeResult = creep.upgradeController(creep.room.controller);
            
            if (upgradeResult === ERR_NOT_IN_RANGE) {
                // Use cached position if available
                if (creep.memory.controllerPos) {
                    creep.moveTo(
                        new RoomPosition(
                            creep.memory.controllerPos.x,
                            creep.memory.controllerPos.y,
                            creep.memory.controllerPos.roomName
                        ),
                        { reusePath: 20 } // Reuse path for longer since controller position is static
                    );
                } else {
                    creep.moveTo(creep.room.controller, { reusePath: 20 });
                }
            }
        } else {
            // Get energy from the most efficient source
            this.getEnergy(creep);
        }
    },
    
    /**
     * Get energy from the most efficient source
     * @param {Creep} creep - The creep to get energy for
     */
    getEnergy: function(creep) {
        // Use cached energy source if available
        let source = creep.memory.energySourceId ? Game.getObjectById(creep.memory.energySourceId) : null;
        
        // Validate source still has energy
        if (source) {
            if ((source.amount !== undefined && source.amount < 50) || 
                (source.store && source.store[RESOURCE_ENERGY] === 0)) {
                source = null;
                delete creep.memory.energySourceId;
            }
        }
        
        // Find new energy source if needed
        if (!source) {
            // First check for containers near the controller (most efficient)
            if (!creep.memory.nearbyContainersChecked || Game.time - creep.memory.nearbyContainersChecked > 50) {
                const containers = creep.pos.findInRange(FIND_STRUCTURES, 5, {
                    filter: s => s.structureType === STRUCTURE_CONTAINER && 
                              s.store[RESOURCE_ENERGY] > creep.store.getFreeCapacity() / 2
                });
                
                if (containers.length > 0) {
                    source = containers[0];
                    creep.memory.energySourceId = source.id;
                }
                
                creep.memory.nearbyContainersChecked = Game.time;
            }
            
            // Check for storage
            if (!source && creep.room.storage && creep.room.storage.store[RESOURCE_ENERGY] > 0) {
                source = creep.room.storage;
                creep.memory.energySourceId = source.id;
            }
            
            // If no container or storage, use room's cached energy sources
            if (!source && creep.room.memory.energySources && Game.time - (creep.room.memory.energySourcesTime || 0) < 10) {
                for (const id of creep.room.memory.energySources) {
                    const potentialSource = Game.getObjectById(id);
                    if ((potentialSource && potentialSource.amount !== undefined && potentialSource.amount >= 50) || 
                        (potentialSource && potentialSource.store && potentialSource.store[RESOURCE_ENERGY] > 0)) {
                        source = potentialSource;
                        creep.memory.energySourceId = id;
                        break;
                    }
                }
            }
            
            // Last resort - find active source
            if (!source) {
                // Limit expensive searches
                if (!creep.memory.lastSourceSearch || Game.time - creep.memory.lastSourceSearch > 10) {
                    const activeSources = creep.room.find(FIND_SOURCES_ACTIVE);
                    if (activeSources.length > 0) {
                        // Find closest source
                        let closestSource = activeSources[0];
                        let minDistance = creep.pos.getRangeTo(closestSource);
                        
                        for (let i = 1; i < activeSources.length; i++) {
                            const distance = creep.pos.getRangeTo(activeSources[i]);
                            if (distance < minDistance) {
                                closestSource = activeSources[i];
                                minDistance = distance;
                            }
                        }
                        
                        source = closestSource;
                        creep.memory.energySourceId = source.id;
                    }
                    
                    creep.memory.lastSourceSearch = Game.time;
                }
            }
        }
        
        // Interact with the source if found
        if (source) {
            let actionResult;
            
            // Cache source position for more efficient movement
            if (!creep.memory.sourcePos) {
                creep.memory.sourcePos = {
                    x: source.pos.x,
                    y: source.pos.y,
                    roomName: source.pos.roomName
                };
            }
            
            if (source.amount !== undefined) {
                actionResult = creep.pickup(source);
            } else if (source.energy !== undefined) {
                actionResult = creep.harvest(source);
            } else {
                actionResult = creep.withdraw(source, RESOURCE_ENERGY);
            }
            
            if (actionResult === ERR_NOT_IN_RANGE) {
                // Use cached position for movement
                creep.moveTo(
                    new RoomPosition(
                        creep.memory.sourcePos.x,
                        creep.memory.sourcePos.y,
                        creep.memory.sourcePos.roomName
                    ),
                    { reusePath: 15 }
                );
            }
        } else {
            // If no energy source found, move to controller area to wait
            if (creep.memory.controllerPos) {
                creep.moveTo(
                    new RoomPosition(
                        creep.memory.controllerPos.x + 2,
                        creep.memory.controllerPos.y + 2,
                        creep.memory.controllerPos.roomName
                    ),
                    { reusePath: 20 }
                );
            }
        }
    }
};

module.exports = roleUpgrader;