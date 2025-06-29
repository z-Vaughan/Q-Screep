/**
 * Room Manager - Centralized room intelligence with CPU optimization
 */
const roomManager = {
    // Cache for room data to avoid memory reads
    cache: {},
    
    /**
     * Updates and caches room data for efficient access
     * @param {Room} room - The room to analyze
     */
    updateRoomData: function(room) {
        const utils = require('utils');
        
        try {
            // Skip if we've already processed this room this tick
            const roomTickKey = `${room.name}_processed`;
            if (this.cache[roomTickKey] === Game.time) return;
            this.cache[roomTickKey] = Game.time;
            
            // Initialize cache for this room if needed
            if (!this.cache[room.name]) {
                this.cache[room.name] = {};
            }
            
            // Initialize room memory if needed
            if (!room.memory.sources) {
                room.memory.sources = {};
                room.memory.lastUpdate = 0;
            }
            
            // Determine update frequency based on CPU conditions - cache this calculation
            const updateFreqKey = 'updateFreq';
            let fullUpdateInterval;
            
            if (this.cache[updateFreqKey] && this.cache[updateFreqKey].time === Game.time) {
                fullUpdateInterval = this.cache[updateFreqKey].value;
            } else {
                fullUpdateInterval = 20; // Default interval
                
                // Adjust interval based on emergency mode
                if (global.emergencyMode) {
                    fullUpdateInterval = global.emergencyMode.level === 'critical' ? 100 : 50;
                } else if (Game.cpu.bucket < 3000) {
                    fullUpdateInterval = 40;
                }
                
                this.cache[updateFreqKey] = {
                    time: Game.time,
                    value: fullUpdateInterval
                };
            }
            
            const needsFullUpdate = Game.time - room.memory.lastUpdate >= fullUpdateInterval;
            
            // Always update these critical values every tick
            this.cache[room.name].energyAvailable = room.energyAvailable;
            this.cache[room.name].energyCapacityAvailable = room.energyCapacityAvailable;
            
            // Count creeps by role (only once per tick)
            if (!this.cache.creepCounts || Game.time !== (this.cache.creepCountsTime || 0)) {
                this.cache.creepCounts = this.countCreepsByRole();
                this.cache.creepCountsTime = Game.time;
            }
            
            // Get creep counts for this room
            this.cache[room.name].creepCounts = this.cache.creepCounts[room.name] || {
                harvester: 0, hauler: 0, upgrader: 0, builder: 0, total: 0
            };
            
            // Calculate energy needs - always needed for proper functioning
            this.calculateEnergyNeeds(room);
            
            // Perform full update when needed and CPU allows
            if (needsFullUpdate && utils.shouldExecute('medium')) {
                this.performFullUpdate(room);
            }
        } catch (error) {
            console.log(`Error in roomManager.updateRoomData for room ${room.name}: ${error}`);
            // Ensure we have at least basic data in cache
            if (!this.cache[room.name]) {
                this.cache[room.name] = {
                    energyAvailable: room.energyAvailable,
                    energyCapacityAvailable: room.energyCapacityAvailable,
                    creepCounts: { harvester: 0, hauler: 0, upgrader: 0, builder: 0, total: 0 }
                };
            }
        }
        
        // Write critical data to memory at the end of the tick
        // This reduces memory operations which are CPU intensive
        if (!this.cache.memoryUpdateScheduled) {
            this.cache.memoryUpdateScheduled = true;
            
            // Schedule memory update at the end of the tick
            this.scheduleMemoryUpdate();
        }
    },
    
    /**
     * Schedule memory update at the end of the tick
     */
    scheduleMemoryUpdate: function() {
        // Use post-tick callback if available
        if (typeof Game.cpu.setPostTickCallback === 'function') {
            Game.cpu.setPostTickCallback(() => this.updateMemory());
        } else {
            // Fallback to immediate update
            this.updateMemory();
        }
    },
    
    /**
     * Update memory from cache
     */
    updateMemory: function() {
        for (const roomName in this.cache) {
            if (roomName === 'creepCounts' || roomName === 'creepCountsTime' || roomName === 'memoryUpdateScheduled') continue;
            
            const roomCache = this.cache[roomName];
            const roomMemory = Memory.rooms[roomName] = Memory.rooms[roomName] || {};
            
            // Update critical values
            roomMemory.energyAvailable = roomCache.energyAvailable;
            roomMemory.energyCapacityAvailable = roomCache.energyCapacityAvailable;
            roomMemory.creepCounts = roomCache.creepCounts;
            roomMemory.priorities = roomCache.priorities;
            
            // Update construction data
            if (roomCache.constructionSites !== undefined) {
                roomMemory.constructionSites = roomCache.constructionSites;
            }
            if (roomCache.constructionSiteIds) {
                roomMemory.constructionSiteIds = roomCache.constructionSiteIds;
            }
            if (roomCache.sitesByType) {
                roomMemory.sitesByType = roomCache.sitesByType;
            }
            
            // Update energy source data
            if (roomCache.energySources) {
                roomMemory.energySources = roomCache.energySources;
            }
            if (roomCache.energySourcesTime) {
                roomMemory.energySourcesTime = roomCache.energySourcesTime;
            }
            
            // Update active sources data
            if (roomCache.activeSources) {
                roomMemory.activeSources = roomCache.activeSources;
            }
            if (roomCache.activeSourcesTime) {
                roomMemory.activeSourcesTime = roomCache.activeSourcesTime;
            }
        }
        
        this.cache.memoryUpdateScheduled = false;
    },
    
    /**
     * Perform a full update of room data
     * @param {Room} room - The room to update
     */
    performFullUpdate: function(room) {
        const utils = require('utils');
        
        // Find and cache sources - use cached find to reduce CPU
        const sources = utils.cachedFind(room, FIND_SOURCES, {}, 500); // Sources don't change often
        
        // Track active sources
        const activeSources = sources.filter(source => source.energy > 0).map(source => source.id);
        this.cache[room.name].activeSources = activeSources;
        this.cache[room.name].activeSourcesTime = Game.time;
        
        // Initialize energy request registry if it doesn't exist
        if (!room.memory.energyRequests) {
            room.memory.energyRequests = {};
        }
        
        // Clean up stale energy requests - only do this every 10 ticks to save CPU
        if (Game.time % 10 === 0) {
            this.cleanupEnergyRequests(room);
        }
        
        // Process sources that don't have data yet
        const unprocessedSources = sources.filter(source => !room.memory.sources[source.id]);
        if (unprocessedSources.length > 0) {
            const terrain = room.getTerrain();
            
            for (const source of unprocessedSources) {
                let availableSpots = 0;
                
                for (let dx = -1; dx <= 1; dx++) {
                    for (let dy = -1; dy <= 1; dy++) {
                        if (dx === 0 && dy === 0) continue;
                        
                        const x = source.pos.x + dx;
                        const y = source.pos.y + dy;
                        
                        if (x >= 0 && y >= 0 && x < 50 && y < 50 && 
                            terrain.get(x, y) !== TERRAIN_MASK_WALL) {
                            availableSpots++;
                        }
                    }
                }
                
                room.memory.sources[source.id] = {
                    pos: {x: source.pos.x, y: source.pos.y},
                    availableSpots: availableSpots,
                    assignedHarvesters: 0
                };
            }
        }
        
        // Batch find operations to reduce CPU usage - use cached find
        const structures = utils.cachedFind(room, FIND_STRUCTURES, {}, 20);
        
        // Find and cache construction sites
        const sites = utils.cachedFind(room, FIND_CONSTRUCTION_SITES, {}, 10);
        this.cache[room.name].constructionSites = sites.length;
        
        // Cache construction site IDs and details for builders
        if (sites.length > 0) {
            this.cache[room.name].constructionSiteIds = sites.map(s => s.id);
            
            // Group by type for prioritization - use cached calculation if available
            const sitesByTypeKey = `sitesByType_${room.name}`;
            if (!this.cache[sitesByTypeKey] || this.cache[sitesByTypeKey].time !== Game.time) {
                const sitesByType = _.groupBy(sites, site => site.structureType);
                this.cache[sitesByTypeKey] = {
                    time: Game.time,
                    value: Object.keys(sitesByType).map(type => ({
                        type: type,
                        count: sitesByType[type].length
                    }))
                };
            }
            
            this.cache[room.name].sitesByType = this.cache[sitesByTypeKey].value;
            
            // Log construction activity
            if (Game.time % 50 === 0 || !room.memory.lastConstructionLog || 
                Game.time - room.memory.lastConstructionLog > 100) {
                console.log(`Room ${room.name} construction: ${sites.length} sites - ` + 
                    this.cache[room.name].sitesByType.map(site => 
                        `${site.count} ${site.type}`
                    ).join(', '));
                room.memory.lastConstructionLog = Game.time;
            }
        } else {
            this.cache[room.name].constructionSiteIds = [];
            this.cache[room.name].sitesByType = [];
        }
        
        // Find structures needing repair - cache this calculation
        const repairCacheKey = `repairTargets_${room.name}`;
        if (!this.cache[repairCacheKey] || this.cache[repairCacheKey].time !== Game.time) {
            this.cache[repairCacheKey] = {
                time: Game.time,
                value: _.filter(structures, s => 
                    s.hits < s.hitsMax && s.hits < 10000
                ).length
            };
        }
        
        this.cache[room.name].repairTargets = this.cache[repairCacheKey].value;
        
        // Cache energy structures for haulers - cache this calculation
        const energyStructuresCacheKey = `energyStructures_${room.name}`;
        if (!this.cache[energyStructuresCacheKey] || this.cache[energyStructuresCacheKey].time !== Game.time) {
            this.cache[energyStructuresCacheKey] = {
                time: Game.time,
                value: _.filter(structures, s => 
                    (s.structureType === STRUCTURE_EXTENSION || 
                     s.structureType === STRUCTURE_SPAWN || 
                     s.structureType === STRUCTURE_TOWER)
                ).map(s => s.id)
            };
        }
        
        this.cache[room.name].energyStructures = this.cache[energyStructuresCacheKey].value;
        
        // Update timestamp
        room.memory.lastUpdate = Game.time;
    },
    
    /**
     * Count creeps by role for all rooms
     * @returns {Object} - Count of creeps by role per room
     */
    countCreepsByRole: function() {
        // Use cached result if we've already calculated this tick
        const cacheKey = 'creepCounts';
        if (this.cache[cacheKey] && this.cache[cacheKey].time === Game.time) {
            return this.cache[cacheKey].value;
        }
        
        const counts = {};
        
        // Initialize counts for each room
        for (const roomName in Game.rooms) {
            if (Game.rooms[roomName].controller && Game.rooms[roomName].controller.my) {
                counts[roomName] = {
                    harvester: 0,
                    hauler: 0,
                    upgrader: 0,
                    builder: 0,
                    total: 0
                };
            }
        }
        
        // Count all creeps in one pass
        for (const name in Game.creeps) {
            const creep = Game.creeps[name];
            const homeRoom = creep.memory.homeRoom;
            
            if (counts[homeRoom]) {
                const role = creep.memory.role;
                if (counts[homeRoom][role] !== undefined) {
                    counts[homeRoom][role]++;
                }
                counts[homeRoom].total++;
            }
        }
        
        // Cache the result for this tick
        this.cache[cacheKey] = {
            time: Game.time,
            value: counts
        };
        return counts;
    },
    
    /**
     * Calculate energy needs for the room
     * @param {Room} room - The room to analyze
     */
    calculateEnergyNeeds: function(room) {
        // Controller upgrading priority
        const controllerLevel = room.controller.level;
        const controllerProgress = room.controller.progress;
        const controllerNextLevel = room.controller.progressTotal;
        const controllerRatio = controllerNextLevel ? controllerProgress / controllerNextLevel : 0;
        
        // Construction priority
        const constructionSites = this.cache[room.name].constructionSites || 0;
        
        // Repair priority
        const repairTargets = this.cache[room.name].repairTargets || 0;
        
        // Calculate priorities
        this.cache[room.name].priorities = {
            upgrade: controllerLevel < 2 || controllerRatio > 0.8 ? 'high' : 'medium',
            build: constructionSites > 0 ? 'high' : 'low',
            repair: repairTargets > 0 ? 'medium' : 'low'
        };
    },
    
    /**
     * Get the best source for a harvester to mine
     * @param {Room} room - The room to check
     * @returns {Source|null} - The best source or null if none available
     */
    getBestSource: function(room) {
        // Safety check for room memory
        if (!room || !room.memory || !room.memory.sources) {
            return null;
        }
        
        // Find source with the lowest harvester-to-capacity ratio
        let bestSourceId = null;
        let lowestRatio = Infinity;
        
        for (const sourceId in room.memory.sources) {
            const sourceMemory = room.memory.sources[sourceId];
            if (!sourceMemory || !sourceMemory.availableSpots) continue;
            
            // Skip sources that are already at capacity
            if (sourceMemory.assignedHarvesters >= sourceMemory.availableSpots) continue;
            
            // Skip sources near source keepers
            if (sourceMemory.nearKeeper === true) continue;
            
            // Calculate ratio of assigned harvesters to available spots
            const ratio = sourceMemory.assignedHarvesters / sourceMemory.availableSpots;
            
            // Choose source with lowest ratio (most available capacity)
            if (ratio < lowestRatio) {
                lowestRatio = ratio;
                bestSourceId = sourceId;
            }
        }
        
        // Assign harvester to the best source
        if (bestSourceId) {
            const source = Game.getObjectById(bestSourceId);
            if (source) {
                room.memory.sources[bestSourceId].assignedHarvesters++;
                return source;
            } else {
                // Source no longer exists, clean up memory
                delete room.memory.sources[bestSourceId];
            }
        }
        
        return null;
    },
    
    /**
     * Release a source assignment when a harvester dies
     * @param {string} sourceId - ID of the source
     * @param {string} roomName - Name of the room
     */
    releaseSource: function(sourceId, roomName) {
        const room = Game.rooms[roomName];
        if (room && room.memory.sources && room.memory.sources[sourceId]) {
            room.memory.sources[sourceId].assignedHarvesters = 
                Math.max(0, room.memory.sources[sourceId].assignedHarvesters - 1);
        }
    },
    
    /**
     * Clean up stale energy requests
     * @param {Room} room - The room to clean up requests for
     */
    cleanupEnergyRequests: function(room) {
        if (!room.memory.energyRequests) return;
        
        // Only process a subset of requests each tick to distribute CPU load
        const currentTime = Game.time;
        const requestIds = Object.keys(room.memory.energyRequests);
        
        // Process at most 10 requests per call
        const startIdx = currentTime % Math.max(1, Math.ceil(requestIds.length / 10));
        const endIdx = Math.min(startIdx + 10, requestIds.length);
        const requestsToProcess = requestIds.slice(startIdx, endIdx);
        
        const requestsToDelete = [];
        
        for (const requestId of requestsToProcess) {
            const request = room.memory.energyRequests[requestId];
            
            // Check if the request is stale (older than 50 ticks)
            if (request.timestamp && currentTime - request.timestamp > 50) {
                requestsToDelete.push(requestId);
                continue;
            }
            
            // Check if the target creep still exists
            const targetCreep = Game.getObjectById(requestId);
            if (!targetCreep) {
                requestsToDelete.push(requestId);
                continue;
            }
            
            // Check if the target creep still needs energy
            if (targetCreep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
                requestsToDelete.push(requestId);
                continue;
            }
            
            // Check if the assigned hauler still exists and is still assigned
            if (request.assignedHaulerId) {
                const hauler = Game.getObjectById(request.assignedHaulerId);
                if (!hauler || hauler.memory.assignedRequestId !== requestId) {
                    delete request.assignedHaulerId;
                }
            }
        }
        
        // Delete all identified stale requests
        for (const requestId of requestsToDelete) {
            delete room.memory.energyRequests[requestId];
        }
    },
    
    /**
     * Get cached room data
     * @param {string} roomName - Name of the room
     * @param {string} key - Data key to retrieve
     * @returns {*} - The requested data or undefined if not found
     */
    getRoomData: function(roomName, key) {
        if (this.cache[roomName] && this.cache[roomName][key] !== undefined) {
            return this.cache[roomName][key];
        }
        
        // Fallback to memory if not in cache
        if (Memory.rooms[roomName] && Memory.rooms[roomName][key] !== undefined) {
            return Memory.rooms[roomName][key];
        }
        
        return undefined;
    },
    
    /**
     * Clean up the cache to prevent memory bloat
     */
    cleanCache: function() {
        // Get current tick for reference
        const currentTick = Game.time;
        
        // Clean up time-based cache entries
        for (const key in this.cache) {
            // Skip room data caches
            if (Game.rooms[key]) continue;
            
            // Clean up time-value pairs older than current tick
            if (this.cache[key] && typeof this.cache[key] === 'object' && this.cache[key].time !== undefined) {
                if (this.cache[key].time !== currentTick) {
                    delete this.cache[key];
                }
            }
        }
    }
};

module.exports = roomManager;