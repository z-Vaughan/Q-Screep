/**
 * Hauler Role - Energy transport
 * Optimized for CPU efficiency
 */
const roleHauler = {
    run: function(creep) {
        // State switching with minimal operations
        if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
            creep.memory.working = false;
        } else if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
            creep.memory.working = true;
            // Pre-calculate target when switching to delivery mode
            this.findDeliveryTarget(creep);
        }
        
        // Execute current state
        if (creep.memory.working) {
            this.deliverEnergy(creep);
        } else {
            this.collectEnergy(creep);
        }
    },
    
    findDeliveryTarget: function(creep) {
        const room = creep.room;
        
        // Use cached room data if available
        if (room.memory.energyStructures && Game.time - (room.memory.energyStructuresTime || 0) < 10) {
            for (const id of room.memory.energyStructures) {
                const target = Game.getObjectById(id);
                if (target && target.store && target.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
                    creep.memory.targetId = id;
                    return;
                }
            }
        }
        
        // Find all energy-needing structures in one operation
        const targets = room.find(FIND_STRUCTURES, {
            filter: s => (
                ((s.structureType === STRUCTURE_EXTENSION || s.structureType === STRUCTURE_SPAWN) && 
                 s.store.getFreeCapacity(RESOURCE_ENERGY) > 0) ||
                (s.structureType === STRUCTURE_TOWER && 
                 s.store.getFreeCapacity(RESOURCE_ENERGY) > s.store.getCapacity(RESOURCE_ENERGY) * 0.2) ||
                s.structureType === STRUCTURE_STORAGE
            )
        });
        
        // Sort by priority and distance
        if (targets.length) {
            targets.sort((a, b) => {
                // Priority: Spawn/Extension > Tower > Storage
                const typeA = a.structureType === STRUCTURE_EXTENSION || a.structureType === STRUCTURE_SPAWN ? 0 :
                             a.structureType === STRUCTURE_TOWER ? 1 : 2;
                const typeB = b.structureType === STRUCTURE_EXTENSION || b.structureType === STRUCTURE_SPAWN ? 0 :
                             b.structureType === STRUCTURE_TOWER ? 1 : 2;
                
                if (typeA !== typeB) return typeA - typeB;
                
                // If same type, sort by distance
                return creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b);
            });
            
            creep.memory.targetId = targets[0].id;
            
            // Cache energy structures for the room
            if (!room.memory.energyStructures || Game.time - (room.memory.energyStructuresTime || 0) >= 10) {
                room.memory.energyStructures = targets.map(t => t.id);
                room.memory.energyStructuresTime = Game.time;
            }
        } else {
            // Controller as fallback
            creep.memory.targetId = room.controller.id;
        }
    },
    
    deliverEnergy: function(creep) {
        // Use cached target if available
        let target = creep.memory.targetId ? Game.getObjectById(creep.memory.targetId) : null;
        
        // Validate target still needs energy
        if (!target || (target.store && target.store.getFreeCapacity(RESOURCE_ENERGY) === 0)) {
            this.findDeliveryTarget(creep);
            target = creep.memory.targetId ? Game.getObjectById(creep.memory.targetId) : null;
        }
        
        if (target) {
            // Handle controller separately
            if (target.structureType === STRUCTURE_CONTROLLER) {
                if (creep.upgradeController(target) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(target, { reusePath: 10 });
                }
            } else {
                // Transfer energy to structure
                if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(target, { reusePath: 10 });
                }
            }
        }
    },
    
    collectEnergy: function(creep) {
        // Use cached source if available and still valid
        let source = creep.memory.sourceId ? Game.getObjectById(creep.memory.sourceId) : null;
        
        // Validate source still has energy
        if (!source || 
            (source.amount !== undefined && source.amount < 50) || 
            (source.store && source.store[RESOURCE_ENERGY] === 0)) {
            source = null;
            creep.memory.sourceId = null;
        }
        
        if (!source) {
            // Use room cache if available
            if (creep.room.memory.energySources && Game.time - (creep.room.memory.energySourcesTime || 0) < 10) {
                for (const id of creep.room.memory.energySources) {
                    const potentialSource = Game.getObjectById(id);
                    if ((potentialSource && potentialSource.amount !== undefined && potentialSource.amount >= 50) || 
                        (potentialSource && potentialSource.store && potentialSource.store[RESOURCE_ENERGY] > 0)) {
                        source = potentialSource;
                        creep.memory.sourceId = id;
                        break;
                    }
                }
            }
            
            // If no valid source in cache, find new sources
            if (!source) {
                // Find all energy sources in one operation
                const droppedResources = creep.room.find(FIND_DROPPED_RESOURCES, {
                    filter: r => r.resourceType === RESOURCE_ENERGY && r.amount >= 50
                });
                
                const containers = creep.room.find(FIND_STRUCTURES, {
                    filter: s => s.structureType === STRUCTURE_CONTAINER && 
                              s.store[RESOURCE_ENERGY] > 0
                });
                
                const tombstones = creep.room.find(FIND_TOMBSTONES, {
                    filter: t => t.store[RESOURCE_ENERGY] > 0
                });
                
                // Combine all sources
                const allSources = [
                    ...droppedResources,
                    ...containers,
                    ...(creep.room.storage && creep.room.storage.store[RESOURCE_ENERGY] > 0 ? [creep.room.storage] : []),
                    ...tombstones
                ];
                
                // Sort by priority and distance
                if (allSources.length) {
                    allSources.sort((a, b) => {
                        // Priority: Dropped > Container > Storage > Tombstone
                        const typeA = a.amount !== undefined ? 0 : 
                                    a.structureType === STRUCTURE_CONTAINER ? 1 :
                                    a.structureType === STRUCTURE_STORAGE ? 2 : 3;
                        const typeB = b.amount !== undefined ? 0 : 
                                    b.structureType === STRUCTURE_CONTAINER ? 1 :
                                    b.structureType === STRUCTURE_STORAGE ? 2 : 3;
                        
                        if (typeA !== typeB) return typeA - typeB;
                        
                        // If same type, sort by distance
                        return creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b);
                    });
                    
                    source = allSources[0];
                    creep.memory.sourceId = source.id;
                    
                    // Cache energy sources for the room
                    creep.room.memory.energySources = allSources.map(s => s.id);
                    creep.room.memory.energySourcesTime = Game.time;
                }
            }
        }
        
        if (source) {
            // Interact with the source based on its type
            let actionResult;
            
            if (source.amount !== undefined) {
                actionResult = creep.pickup(source);
            } else {
                actionResult = creep.withdraw(source, RESOURCE_ENERGY);
            }
            
            if (actionResult === ERR_NOT_IN_RANGE) {
                creep.moveTo(source, { reusePath: 10 });
            }
        } else {
            // If no energy sources, wait near spawn
            const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
            if (spawn) {
                creep.moveTo(spawn, { range: 3, reusePath: 20 });
            }
        }
    }
};

module.exports = roleHauler;