/**
 * Builder Role - Construction and repair
 * CPU optimized for maximum efficiency
 */
const roleBuilder = {
    /**
     * Run the builder role
     * @param {Creep} creep - The creep to run the role for
     */
    run: function(creep) {
        // Initialize building state if not set
        if (creep.memory.building === undefined) {
            creep.memory.building = false;
        }
        
        // State switching with minimal operations
        if (creep.memory.building && creep.store[RESOURCE_ENERGY] === 0) {
            creep.memory.building = false;
            creep.say('🔄');
            // Clear target cache when switching states
            delete creep.memory.targetId;
            delete creep.memory.targetPos;
            console.log(`Builder ${creep.name} switching to harvesting mode`);
        }
        if (!creep.memory.building && creep.store.getFreeCapacity() === 0) {
            creep.memory.building = true;
            creep.say('🚧');
            // Clear target cache when switching states
            delete creep.memory.energySourceId;
            delete creep.memory.sourcePos;
            console.log(`Builder ${creep.name} switching to building mode`);
        }
        
        if (creep.memory.building) {
            this.performBuilding(creep);
        } else {
            this.getEnergy(creep);
        }
    },
    
    /**
     * Handle building and repairing
     * @param {Creep} creep - The creep to perform building
     */
    performBuilding: function(creep) {
        // Use cached target if available
        let target = creep.memory.targetId ? Game.getObjectById(creep.memory.targetId) : null;
        
        // If target is gone or completed, find a new one
        if (!target || (target.progress !== undefined && target.progress === target.progressTotal)) {
            delete creep.memory.targetId;
            delete creep.memory.targetPos;
            
            // Only search for new targets periodically to save CPU
            if (!creep.memory.lastTargetSearch || Game.time - creep.memory.lastTargetSearch > 10) {
                target = this.findBuildTarget(creep);
                creep.memory.lastTargetSearch = Game.time;
            } else {
                // Default to controller between searches
                target = creep.room.controller;
            }
        }
        
        // Cache the target
        if (target) {
            creep.memory.targetId = target.id;
            
            // Cache position if not already done
            if (!creep.memory.targetPos) {
                creep.memory.targetPos = {
                    x: target.pos.x,
                    y: target.pos.y,
                    roomName: target.pos.roomName
                };
            }
            
            // Validate target before interacting
            if (!this.isValidTarget(target)) {
                console.log(`Builder ${creep.name} has invalid target ${target.id}, finding new target`);
                delete creep.memory.targetId;
                delete creep.memory.targetPos;
                return;
            }
            
            // Perform action based on target type
            let actionResult;
            
            try {
                if (target.progressTotal !== undefined) {
                    // Construction site
                    actionResult = creep.build(target);
                } else if (target.structureType === STRUCTURE_CONTROLLER) {
                    // Controller
                    actionResult = creep.upgradeController(target);
                } else {
                    // Repair target
                    actionResult = creep.repair(target);
                }
                
                if (actionResult === ERR_NOT_IN_RANGE) {
                    creep.moveTo(
                        new RoomPosition(
                            creep.memory.targetPos.x,
                            creep.memory.targetPos.y,
                            creep.memory.targetPos.roomName
                        ),
                        { 
                            reusePath: 10,
                            visualizePathStyle: {stroke: '#3333ff'}
                        }
                    );
                } else if (actionResult === ERR_INVALID_TARGET) {
                    console.log(`Builder ${creep.name} has invalid target ${target.id}, finding new target`);
                    delete creep.memory.targetId;
                    delete creep.memory.targetPos;
                } else if (actionResult !== OK) {
                    // Log errors other than distance
                    console.log(`Builder ${creep.name} error: ${actionResult} when interacting with target ${target.id}`);
                }
            } catch (e) {
                console.log(`Builder ${creep.name} exception: ${e} when interacting with target ${target.id}`);
                delete creep.memory.targetId;
                delete creep.memory.targetPos;
            }
        }
    },
    
    /**
     * Find a build or repair target
     * @param {Creep} creep - The creep to find a target for
     * @returns {Object} - The target object
     */
    findBuildTarget: function(creep) {
        const roomManager = require('roomManager');
        let target = null;
        
        // Get construction site data from room manager
        const constructionSiteIds = roomManager.getRoomData(creep.room.name, 'constructionSiteIds');
        
        // Check if there are construction sites
        if (constructionSiteIds && constructionSiteIds.length > 0) {
            // Convert IDs to actual objects
            const sites = [];
            for (const id of constructionSiteIds) {
                const site = Game.getObjectById(id);
                if (site && site.progress < site.progressTotal) {
                    sites.push(site);
                }
            }
            
            if (sites.length > 0) {
                // Prioritize certain structure types
                const priorityOrder = [STRUCTURE_SPAWN, STRUCTURE_EXTENSION, STRUCTURE_TOWER, STRUCTURE_CONTAINER, STRUCTURE_ROAD];
                
                // Sort sites by priority
                sites.sort((a, b) => {
                    const aPriority = priorityOrder.indexOf(a.structureType);
                    const bPriority = priorityOrder.indexOf(b.structureType);
                    
                    // If both have a priority, use it
                    if (aPriority !== -1 && bPriority !== -1) {
                        return aPriority - bPriority;
                    }
                    
                    // If only one has a priority, it comes first
                    if (aPriority !== -1) return -1;
                    if (bPriority !== -1) return 1;
                    
                    // Otherwise, sort by progress (prefer more complete structures)
                    return (b.progress / b.progressTotal) - (a.progress / a.progressTotal);
                });
                
                // Take the highest priority site that's closest
                const highestPriority = sites[0].structureType;
                const highPrioritySites = sites.filter(s => s.structureType === highestPriority);
                
                target = this.findClosestByRange(creep, highPrioritySites);
                
                if (target) {
                    console.log(`Builder ${creep.name} found ${target.structureType} construction site at ${target.pos.x},${target.pos.y}`);
                    return target;
                }
            } else {
                // If we had IDs but no valid sites, update the room manager
                if (creep.room.memory.constructionSiteIds) {
                    creep.room.memory.constructionSiteIds = [];
                    creep.room.memory.constructionSites = 0;
                }
            }
        }
        
        // If no construction sites, look for repair targets
        if (!target) {
            // Prioritize critical structures (roads, containers)
            const repairTargets = creep.room.find(FIND_STRUCTURES, {
                filter: s => s.hits < s.hitsMax * 0.5 && // Only repair if below 50%
                          s.hits < 10000 && // Don't repair walls/ramparts beyond this in early game
                          (s.structureType === STRUCTURE_ROAD || 
                           s.structureType === STRUCTURE_CONTAINER || 
                           s.structureType === STRUCTURE_SPAWN ||
                           s.structureType === STRUCTURE_EXTENSION)
            });
            
            if (repairTargets.length > 0) {
                target = this.findClosestByRange(creep, repairTargets);
            }
        }
        
        // If no repair targets, default to controller
        if (!target) {
            target = creep.room.controller;
        }
        
        return target;
    },
    
    /**
     * Find closest object by range (CPU efficient)
     * @param {Creep} creep - The creep to measure distance from
     * @param {Array} objects - Array of objects to check
     * @returns {Object} - The closest object
     */
    findClosestByRange: function(creep, objects) {
        if (!objects.length) return null;
        
        let closest = objects[0];
        let minDistance = creep.pos.getRangeTo(closest);
        
        for (let i = 1; i < objects.length; i++) {
            const distance = creep.pos.getRangeTo(objects[i]);
            if (distance < minDistance) {
                closest = objects[i];
                minDistance = distance;
            }
        }
        
        return closest;
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
                delete creep.memory.sourcePos;
            }
        }
        
        // Find new energy source if needed
        if (!source) {
            source = this.findEnergySource(creep);
        }
        
        // Interact with the source if found
        if (source) {
            this.harvestEnergySource(creep, source);
        } else {
            // If no energy source found, move to a waiting area near spawn
            const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
            if (spawn) {
                creep.moveTo(spawn, { range: 3, reusePath: 20 });
            }
        }
    },
    
    /**
     * Find an energy source
     * @param {Creep} creep - The creep to find a source for
     * @returns {Object} - The energy source
     */
    findEnergySource: function(creep) {
        const roomManager = require('roomManager');
        let source = null;
        
        // Use room's cached energy sources if available
        const energySources = roomManager.getRoomData(creep.room.name, 'energySources');
        const energySourcesTime = roomManager.getRoomData(creep.room.name, 'energySourcesTime');
        
        if (energySources && Game.time - (energySourcesTime || 0) < 10) {
            for (const id of energySources) {
                const potentialSource = Game.getObjectById(id);
                if ((potentialSource && potentialSource.amount !== undefined && potentialSource.amount >= 50) || 
                    (potentialSource && potentialSource.store && potentialSource.store[RESOURCE_ENERGY] > 0)) {
                    source = potentialSource;
                    creep.memory.energySourceId = id;
                    break;
                }
            }
        } else {
            // Only search for new sources periodically
            if (!creep.memory.lastSourceSearch || Game.time - creep.memory.lastSourceSearch > 10) {
                // Check storage first
                if (creep.room.storage && creep.room.storage.store[RESOURCE_ENERGY] > 0) {
                    source = creep.room.storage;
                } else {
                    // Find all potential energy sources in one operation
                    const containers = creep.room.find(FIND_STRUCTURES, {
                        filter: s => s.structureType === STRUCTURE_CONTAINER && 
                                  s.store[RESOURCE_ENERGY] > creep.store.getFreeCapacity() / 2
                    });
                    
                    const droppedResources = creep.room.find(FIND_DROPPED_RESOURCES, {
                        filter: r => r.resourceType === RESOURCE_ENERGY && r.amount > 50
                    });
                    
                    const activeSources = creep.room.find(FIND_SOURCES_ACTIVE);
                    
                    // Combine all sources and find closest
                    const allSources = [...containers, ...droppedResources, ...activeSources];
                    
                    if (allSources.length > 0) {
                        source = this.findClosestByRange(creep, allSources);
                        
                        // Update room's energy sources cache
                        if (!creep.room.memory.energySources) {
                            creep.room.memory.energySources = [];
                        }
                        creep.room.memory.energySources = allSources.map(s => s.id);
                        creep.room.memory.energySourcesTime = Game.time;
                    }
                }
                
                creep.memory.lastSourceSearch = Game.time;
            }
        }
        
        return source;
    },
    
    /**
     * Check if a target is valid for builder interaction
     * @param {Object} target - The target to validate
     * @returns {boolean} - Whether the target is valid
     */
    isValidTarget: function(target) {
        if (!target) return false;
        
        // Check if target is a construction site
        if (target.progressTotal !== undefined) {
            // Valid if it's a construction site that's not complete
            return target.progress < target.progressTotal;
        }
        
        // Check if target is a controller
        if (target.structureType === STRUCTURE_CONTROLLER) {
            // Valid if it's a controller that we own
            return target.my;
        }
        
        // Check if target is a structure that needs repair
        if (target.hits !== undefined && target.hitsMax !== undefined) {
            // Valid if it's a structure that needs repair
            return target.hits < target.hitsMax;
        }
        
        // Not a valid target
        return false;
    },
    
    /**
     * Harvest energy from a source
     * @param {Creep} creep - The creep to harvest with
     * @param {Object} source - The energy source
     */
    harvestEnergySource: function(creep, source) {
        creep.memory.energySourceId = source.id;
        
        // Cache source position for more efficient movement
        if (!creep.memory.sourcePos) {
            creep.memory.sourcePos = {
                x: source.pos.x,
                y: source.pos.y,
                roomName: source.pos.roomName
            };
        }
        
        let actionResult;
        
        if (source.amount !== undefined) {
            actionResult = creep.pickup(source);
        } else if (source.energy !== undefined) {
            actionResult = creep.harvest(source);
        } else {
            actionResult = creep.withdraw(source, RESOURCE_ENERGY);
        }
        
        if (actionResult === ERR_NOT_IN_RANGE) {
            creep.moveTo(
                new RoomPosition(
                    creep.memory.sourcePos.x,
                    creep.memory.sourcePos.y,
                    creep.memory.sourcePos.roomName
                ),
                { 
                    reusePath: 10,
                    visualizePathStyle: {stroke: '#ffaa00'}
                }
            );
        } else if (actionResult !== OK) {
            // Log errors other than distance
            console.log(`Builder ${creep.name} error: ${actionResult} when gathering energy from ${source.id}`);
        }
    }
};

module.exports = roleBuilder;