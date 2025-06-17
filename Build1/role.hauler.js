/**
 * Hauler Role - Energy transport
 * Optimized for CPU efficiency
 */
const roleHauler = {
    run: function(creep) {
        // Check and clean up builder assignments if needed
        this.checkBuilderAssignments(creep);
        
        // State switching with minimal operations
        if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
            creep.memory.working = false;
            // Clear any builder assignments when empty
            if (creep.memory.assignedRequestId) {
                this.clearBuilderAssignment(creep);
            }
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
    
    /**
     * Check and clean up builder assignments if needed
     * @param {Creep} creep - The hauler creep
     */
    checkBuilderAssignments: function(creep) {
        // If we have an assigned builder request, validate it
        if (creep.memory.assignedRequestId) {
            const builder = Game.getObjectById(creep.memory.assignedRequestId);
            const request = creep.room.memory.energyRequests && 
                           creep.room.memory.energyRequests[creep.memory.assignedRequestId];
            
            // Clear assignment if builder or request no longer exists
            if (!builder || !request) {
                this.clearBuilderAssignment(creep);
                return;
            }
            
            // Clear assignment if builder is full
            if (builder.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
                this.clearBuilderAssignment(creep);
                return;
            }
            
            // Clear assignment if we're empty and not working
            if (!creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
                this.clearBuilderAssignment(creep);
                return;
            }
        }
    },
    
    /**
     * Clear a builder assignment
     * @param {Creep} creep - The hauler creep
     */
    clearBuilderAssignment: function(creep) {
        if (creep.memory.assignedRequestId && 
            creep.room.memory.energyRequests && 
            creep.room.memory.energyRequests[creep.memory.assignedRequestId]) {
            
            // Clear the hauler assignment from the request
            if (creep.room.memory.energyRequests[creep.memory.assignedRequestId].assignedHaulerId === creep.id) {
                delete creep.room.memory.energyRequests[creep.memory.assignedRequestId].assignedHaulerId;
            }
        }
        
        // Clear the assignment from the hauler's memory
        delete creep.memory.assignedRequestId;
    },
    
    findDeliveryTarget: function(creep) {
        const room = creep.room;
        const roomManager = require('roomManager');
        
        // First check if spawns or extensions need energy
        const spawnsAndExtensions = room.find(FIND_STRUCTURES, {
            filter: s => (s.structureType === STRUCTURE_EXTENSION || s.structureType === STRUCTURE_SPAWN) && 
                         s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
        });
        
        // If any spawns or extensions need energy, prioritize them
        if (spawnsAndExtensions.length > 0) {
            const closest = spawnsAndExtensions.reduce((closest, structure) => {
                const distance = creep.pos.getRangeTo(structure);
                return !closest || distance < creep.pos.getRangeTo(closest) ? structure : closest;
            }, null);
            
            if (closest) {
                creep.memory.targetId = closest.id;
                return;
            }
        }
        
        // Only check for builder energy requests if spawns and extensions are full
        if (room.memory.energyRequests && Object.keys(room.memory.energyRequests).length > 0) {
            // Find the highest priority builder request
            let bestRequest = null;
            let bestScore = Infinity;
            
            for (const requestId in room.memory.energyRequests) {
                const request = room.memory.energyRequests[requestId];
                
                // Skip if already assigned to another hauler
                if (request.assignedHaulerId && request.assignedHaulerId !== creep.id) {
                    continue;
                }
                
                // Calculate score based on priority and distance
                const builder = Game.getObjectById(requestId);
                if (!builder) {
                    // Clean up invalid requests
                    delete room.memory.energyRequests[requestId];
                    continue;
                }
                
                // Calculate score (lower is better)
                const distance = creep.pos.getRangeTo(builder);
                const waitTime = Game.time - (request.waitStartTime || request.timestamp);
                
                // Factor in wait time - longer wait = higher priority (lower score)
                const waitFactor = Math.max(0, 20 - waitTime) * 2; // Reduce score by up to 40 points for waiting
                
                const score = request.priority + (distance * 0.5) - waitFactor;
                
                if (score < bestScore) {
                    bestScore = score;
                    bestRequest = request;
                }
            }
            
            // If we found a suitable request, assign ourselves to it
            if (bestRequest) {
                room.memory.energyRequests[bestRequest.id].assignedHaulerId = creep.id;
                creep.memory.assignedRequestId = bestRequest.id;
                creep.memory.targetId = bestRequest.id;
                return;
            }
        }
        
        // If no builder requests, proceed with normal delivery targets
        
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
        // Check if we're assigned to a builder request
        if (creep.memory.assignedRequestId) {
            const builder = Game.getObjectById(creep.memory.assignedRequestId);
            const request = creep.room.memory.energyRequests && 
                           creep.room.memory.energyRequests[creep.memory.assignedRequestId];
            
            // Validate builder and request still exist
            if (!builder || !request) {
                delete creep.memory.assignedRequestId;
                delete creep.memory.targetId;
                this.findDeliveryTarget(creep);
                return;
            }
            
            // Check if builder still needs energy
            if (builder.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
                // Builder is full, clear request and find new target
                delete creep.room.memory.energyRequests[creep.memory.assignedRequestId];
                delete creep.memory.assignedRequestId;
                delete creep.memory.targetId;
                this.findDeliveryTarget(creep);
                return;
            }
            
            // If builder has a target site, try to meet them there
            let meetingPoint = null;
            if (request.targetSite) {
                const site = Game.getObjectById(request.targetSite.id);
                if (site) {
                    meetingPoint = site.pos;
                }
            }
            
            // If no meeting point, use builder's position
            if (!meetingPoint) {
                meetingPoint = builder.pos;
            }
            
            // If we're adjacent to the builder, transfer energy
            if (creep.pos.isNearTo(builder)) {
                const result = creep.transfer(builder, RESOURCE_ENERGY);
                if (result === OK) {
                    // Successfully delivered energy
                    creep.say('🔋');
                    
                    // Clear assignment if builder is now full
                    if (builder.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
                        delete creep.room.memory.energyRequests[creep.memory.assignedRequestId];
                    } else {
                        // Just clear our assignment but leave request for others
                        delete creep.room.memory.energyRequests[creep.memory.assignedRequestId].assignedHaulerId;
                    }
                    
                    delete creep.memory.assignedRequestId;
                    delete creep.memory.targetId;
                }
            } else {
                // Move to the builder or meeting point
                creep.moveTo(meetingPoint, { 
                    reusePath: 10,
                    visualizePathStyle: {stroke: '#ffaa00'}
                });
                creep.say('🚚');
            }
            
            return;
        }
        
        // Regular energy delivery logic
        let target = creep.memory.targetId ? Game.getObjectById(creep.memory.targetId) : null;
        
        // Validate target still needs energy
        if (!target || (target.store && target.store.getFreeCapacity(RESOURCE_ENERGY) === 0)) {
            this.findDeliveryTarget(creep);
            target = creep.memory.targetId ? Game.getObjectById(creep.memory.targetId) : null;
        }
        
        if (target) {
            // Handle controller separately
            if (target.structureType === STRUCTURE_CONTROLLER) {
                // Check for builder requests every tick when working with controller
                if (creep.room.memory.energyRequests && 
                    Object.keys(creep.room.memory.energyRequests).length > 0) {
                    // If there are builder requests, prioritize them over controller
                    delete creep.memory.targetId;
                    this.findDeliveryTarget(creep);
                    return;
                }
                
                if (creep.upgradeController(target) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(target, { 
                        reusePath: 10,
                        visualizePathStyle: {stroke: '#ffffff'}
                    });
                }
            } else {
                // Transfer energy to structure
                if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(target, { 
                        reusePath: 10,
                        visualizePathStyle: {stroke: '#ffffff'}
                    });
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