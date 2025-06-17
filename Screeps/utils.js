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
            Spawning: ${stats.spawning.toFixed(2)}
            Construction: ${stats.construction.toFixed(2)}
            Memory Cleanup: ${stats.memoryCleanup.toFixed(2)}
            Bucket: ${Game.cpu.bucket}`);
    }
};

module.exports = utils;