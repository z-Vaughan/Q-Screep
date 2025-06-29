/**
 * Utility functions for CPU optimization
 */
const utils = {
    /**
     * Cache for expensive operations
     */
    cache: {},
    
    /**
     * Run a function with caching based on a key
     * @param {string} key - Cache key
     * @param {function} fn - Function to run
     * @param {number} ttl - Time to live in ticks
     * @returns {*} - Result of the function
     */
    memoize: function(key, fn, ttl = 10) {
        // Check if we have a cached result that's still valid
        if (this.cache[key] && Game.time - this.cache[key].time < ttl) {
            return this.cache[key].result;
        }
        
        // Run the function and cache the result
        const result = fn();
        this.cache[key] = {
            time: Game.time,
            result: result
        };
        
        return result;
    },
    
    /**
     * Clear the cache
     * @param {boolean} preservePositions - Whether to preserve cached positions
     */
    clearCache: function(preservePositions = true) {
        const positions = preservePositions ? this.cache.positions : undefined;
        this.cache = {};
        if (preservePositions && positions) {
            this.cache.positions = positions;
        }
        
        // Clean up any cache keys that were accidentally stored in Memory
        this.cleanupMemoryCache();
    },
    
    /**
     * Clean up cache keys that were accidentally stored in Memory
     */
    cleanupMemoryCache: function() {
        // List of prefixes for cache keys that should not be in Memory
        const cacheKeyPrefixes = [
            'shouldExecute_', 
            'keepers_',
            'find_',
            '_processed_',
            'updateFreq_',
            'creepCounts_',
            'sitesByType_',
            'repairTargets_',
            'energyStructures_'
        ];
        
        // Check Memory for cache keys and remove them
        for (const key in Memory) {
            if (cacheKeyPrefixes.some(prefix => key.startsWith(prefix)) || 
                key.includes('_' + Game.time) || 
                /\d{4,}$/.test(key)) { // Keys ending with 4+ digits (likely tick numbers)
                delete Memory[key];
            }
        }
    },
    
    /**
     * Find closest object by range (CPU efficient)
     * @param {RoomPosition} pos - Position to measure distance from
     * @param {Array} objects - Array of objects to check
     * @returns {Object} - The closest object
     */
    findClosestByRange: function(pos, objects) {
        if (!objects.length) return null;
        
        let closest = objects[0];
        let minDistance = pos.getRangeTo(closest);
        
        for (let i = 1; i < objects.length; i++) {
            const distance = pos.getRangeTo(objects[i]);
            if (distance < minDistance) {
                closest = objects[i];
                minDistance = distance;
            }
        }
        
        return closest;
    },
    
    /**
     * Throttle a function to run only every N ticks
     * @param {function} fn - Function to throttle
     * @param {number} ticks - Number of ticks between runs
     * @param {*} context - Context to bind the function to
     * @returns {function} - Throttled function
     */
    throttle: function(fn, ticks, context) {
        let lastRun = 0;
        
        return function(...args) {
            if (Game.time - lastRun >= ticks) {
                lastRun = Game.time;
                return fn.apply(context || this, args);
            }
        };
    },
    
    /**
     * Run a function only if CPU bucket is above threshold
     * @param {function} fn - Function to run
     * @param {number} threshold - CPU bucket threshold
     * @param {*} context - Context to bind the function to
     * @returns {function} - CPU-aware function
     */
    cpuAware: function(fn, threshold, context) {
        return function(...args) {
            if (Game.cpu.bucket >= threshold) {
                return fn.apply(context || this, args);
            }
        };
    },
    
    /**
     * Cache room positions to avoid creating new objects
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @param {string} roomName - Room name
     * @returns {RoomPosition} - Cached room position
     */
    getCachedPosition: function(x, y, roomName) {
        const key = `${x},${y},${roomName}`;
        
        if (!this.cache.positions) {
            this.cache.positions = {};
        }
        
        if (!this.cache.positions[key]) {
            this.cache.positions[key] = new RoomPosition(x, y, roomName);
        }
        
        return this.cache.positions[key];
    },
    
    /**
     * Measure CPU usage of a function
     * @param {function} fn - Function to measure
     * @param {*} context - Context to bind the function to
     * @param {Array} args - Arguments to pass to the function
     * @returns {Object} - Result and CPU usage
     */
    measureCPU: function(fn, context, ...args) {
        const start = Game.cpu.getUsed();
        const result = fn.apply(context || this, args);
        const end = Game.cpu.getUsed();
        
        return {
            result: result,
            cpu: end - start
        };
    },
    
    /**
     * Log CPU usage statistics
     * @param {Object} stats - CPU statistics object
     */
    logCPUStats: function(stats) {
        console.log(`CPU Usage:
            Total: ${stats.total.toFixed(2)}
            Room Management: ${stats.roomManagement.toFixed(2)}
            Creep Actions: ${stats.creepActions.toFixed(2)}
            Defense: ${stats.defense ? stats.defense.toFixed(2) : '0.00'}
            Spawning: ${stats.spawning.toFixed(2)}
            Construction: ${stats.construction.toFixed(2)}
            Memory Cleanup: ${stats.memoryCleanup.toFixed(2)}
            Emergency Mode: ${stats.emergencyMode || 'off'}
            Bucket: ${stats.bucket}`);
    },
    
    /**
     * Check if an operation should be executed based on current CPU conditions
     * @param {string} priority - Priority level ('critical', 'high', 'medium', 'low')
     * @returns {boolean} - Whether the operation should proceed
     */
    shouldExecute: function(priority) {
        // Use cached result if available (valid for current tick)
        const cacheKey = `shouldExecute_${priority}_${Game.time}`;
        if (this.cache[cacheKey] !== undefined) {
            return this.cache[cacheKey];
        }
        
        // Always execute critical operations
        if (priority === 'critical') {
            this.cache[cacheKey] = true;
            return true;
        }
        
        // Cache simulation check (valid for entire tick)
        if (this.cache.isSimulation === undefined) {
            this.cache.isSimulation = Object.keys(Game.rooms).some(name => name.startsWith('sim'));
            this.cache.isSimulationTime = Game.time;
        }
        
        // Always allow all operations in simulation rooms
        if (this.cache.isSimulation) {
            this.cache[cacheKey] = true;
            return true;
        }
        
        // In emergency mode, only run critical operations
        if (global.emergencyMode) {
            let result;
            if (global.emergencyMode.level === 'critical') {
                result = priority === 'critical';
            } else {
                result = ['critical', 'high'].includes(priority);
            }
            this.cache[cacheKey] = result;
            return result;
        }
        
        // Normal mode - CPU bucket based throttling
        const bucket = Game.cpu.bucket;
        let result;
        
        if (bucket < 1000) result = priority === 'critical';
        else if (bucket < 3000) result = ['critical', 'high'].includes(priority);
        else if (bucket < 7000) result = !['low'].includes(priority);
        else result = true; // Full bucket, run everything
        
        this.cache[cacheKey] = result;
        return result;
    },

    /**
     * Safe object access to prevent errors from undefined properties
     * @param {Object} obj - The object to access
     * @param {string} path - The property path (e.g., 'a.b.c')
     * @param {*} defaultValue - Default value if path doesn't exist
     * @returns {*} - The value at the path or the default value
     */
    getNestedProperty: function(obj, path, defaultValue = undefined) {
        if (!obj || !path) return defaultValue;
        
        const properties = path.split('.');
        let value = obj;
        
        for (const prop of properties) {
            if (value === null || value === undefined || typeof value !== 'object') {
                return defaultValue;
            }
            value = value[prop];
        }
        
        return value !== undefined ? value : defaultValue;
    },
    
    /**
     * Safely execute a function with error handling
     * @param {function} fn - Function to execute
     * @param {Object} context - Context to bind the function to
     * @param {Array} args - Arguments to pass to the function
     * @param {*} defaultValue - Default value to return on error
     * @returns {*} - Result of the function or default value on error
     */
    safeExec: function(fn, context, args = [], defaultValue = null) {
        try {
            return fn.apply(context, args);
        } catch (error) {
            console.log(`Error in safeExec: ${error}`);
            console.log(`Stack trace: ${error.stack}`);
            return defaultValue;
        }
    },
    
    /**
     * Wrap a module's methods with error handling
     * @param {Object} module - The module to wrap
     * @param {string} moduleName - Name of the module for error reporting
     * @returns {Object} - Wrapped module
     */
    wrapModule: function(module, moduleName) {
        const wrapped = {};
        
        for (const key in module) {
            if (typeof module[key] === 'function') {
                wrapped[key] = function(...args) {
                    try {
                        return module[key].apply(module, args);
                    } catch (error) {
                        // Get detailed error information
                        const errorInfo = {
                            message: error.message || String(error),
                            stack: error.stack,
                            method: key,
                            module: moduleName,
                            args: args.map(arg => {
                                if (arg && typeof arg === 'object') {
                                    return arg.name || arg.id || JSON.stringify(arg).substring(0, 50);
                                }
                                return String(arg);
                            })
                        };
                        
                        // Log detailed error
                        console.log(`ERROR in ${moduleName}.${key}: ${errorInfo.message}`);
                        console.log(`Stack: ${errorInfo.stack}`);
                        console.log(`Args: ${errorInfo.args.join(', ')}`);
                        
                        // Store error for debugging
                        if (!global.errors) global.errors = [];
                        global.errors.push({
                            time: Game.time,
                            ...errorInfo
                        });
                        
                        // Keep only the last 10 errors
                        if (global.errors.length > 10) global.errors.shift();
                        
                        throw error; // Re-throw to maintain original behavior
                    }
                };
            } else {
                wrapped[key] = module[key];
            }
        }
        
        return wrapped;
    },
    
    /**
     * Track errors to prevent log spam
     * @param {string} key - Error identifier
     * @param {string} message - Error message
     * @param {number} interval - How often to log this error (in ticks)
     */
    logError: function(key, message, interval = 100) {
        if (!global.errorLog) global.errorLog = {};
        
        const now = Game.time;
        const lastLogged = global.errorLog[key] || 0;
        
        if (now - lastLogged >= interval) {
            console.log(`ERROR [${key}]: ${message}`);
            global.errorLog[key] = now;
        }
    },
    
    /**
     * Check if a position is safe from source keepers
     * @param {RoomPosition} pos - Position to check
     * @param {number} safeDistance - Safe distance from keepers (default: 5)
     * @returns {boolean} - True if position is safe
     */
    isSafeFromKeepers: function(pos, safeDistance = 5) {
        if (!pos || !pos.roomName) return false;
        
        const room = Game.rooms[pos.roomName];
        if (!room) return true; // Assume safe if room not visible
        
        // Cache keeper positions for each room (valid for 20 ticks)
        const cacheKey = `keepers_${room.name}`;
        if (!this.cache[cacheKey] || Game.time - this.cache[cacheKey].time > 20) {
            const keepers = room.find(FIND_HOSTILE_CREEPS, {
                filter: creep => creep.owner.username === 'Source Keeper'
            });
            
            this.cache[cacheKey] = {
                time: Game.time,
                keepers: keepers.map(k => ({ id: k.id, x: k.pos.x, y: k.pos.y }))
            };
        }
        
        const cachedKeepers = this.cache[cacheKey].keepers;
        if (cachedKeepers.length === 0) return true;
        
        // Check distance to each keeper
        for (const keeper of cachedKeepers) {
            const distance = Math.abs(keeper.x - pos.x) + Math.abs(keeper.y - pos.y);
            if (distance <= safeDistance) {
                return false;
            }
        }
        
        return true;
    },
    
    /**
     * Get cached find results to avoid expensive room.find operations
     * @param {Room} room - The room to search in
     * @param {number} findConstant - The FIND_* constant
     * @param {Object} options - Options for the find operation
     * @param {number} ttl - Time to live for the cache in ticks
     * @returns {Array} - The find results
     */
    cachedFind: function(room, findConstant, options = {}, ttl = 10) {
        const cacheKey = `find_${room.name}_${findConstant}_${JSON.stringify(options)}`;
        
        if (this.cache[cacheKey] && Game.time - this.cache[cacheKey].time < ttl) {
            return this.cache[cacheKey].results;
        }
        
        const results = room.find(findConstant, options);
        this.cache[cacheKey] = {
            time: Game.time,
            results: results
        };
        
        return results;
    }
};

module.exports = utils;