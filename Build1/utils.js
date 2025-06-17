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
     */
    clearCache: function() {
        this.cache = {};
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
        // Always execute critical operations
        if (priority === 'critical') return true;
        
        // In emergency mode, only run critical operations
        if (global.emergencyMode) {
            if (global.emergencyMode.level === 'critical') {
                return priority === 'critical';
            } else {
                return ['critical', 'high'].includes(priority);
            }
        }
        
        // Normal mode - CPU bucket based throttling
        const bucket = Game.cpu.bucket;
        
        if (bucket < 1000) return priority === 'critical';
        if (bucket < 3000) return ['critical', 'high'].includes(priority);
        if (bucket < 7000) return !['low'].includes(priority);
        
        // Full bucket, run everything
        return true;
    }
};

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
            return defaultValue;
        }
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
    }
};

module.exports = utils;