/**
 * Remote Manager - Handles operations in remote rooms
 * Optimized for CPU efficiency and resiliency
 */
const utils = require('utils');

const remoteManager = {
    /**
     * Initialize remote operations memory
     */
    initMemory: function() {
        if (!Memory.remoteOps) {
            Memory.remoteOps = {
                rooms: {},
                scouts: {},
                lastUpdate: Game.time
            };
        }
    },
    
    /**
     * Run remote operations manager
     * Only runs when CPU conditions allow
     */
    run: function() {
        // Skip in emergency mode
        if (global.emergencyMode) return;
        
        // Only run every 20 ticks to save CPU
        if (Game.time % 20 !== 0) return;
        
        // Skip if CPU is low
        if (!utils.shouldExecute('low')) return;
        
        // Initialize memory
        this.initMemory();
        
        // Process each owned room
        for (const roomName in Game.rooms) {
            const room = Game.rooms[roomName];
            if (!room.controller || !room.controller.my) continue;
            
            // Skip rooms below RCL 3
            if (room.controller.level < 3) continue;
            
            // Check for adjacent rooms to scout
            this.identifyRoomsToScout(room);
        }
        
        // Update remote room data
        this.updateRemoteRooms();
    },
    
    /**
     * Identify rooms to scout from a base room
     * @param {Room} room - The base room
     */
    identifyRoomsToScout: function(room) {
        // Get exits from the room
        const exits = Game.map.describeExits(room.name);
        
        // Check each exit
        for (const direction in exits) {
            const exitRoom = exits[direction];
            
            // Skip if we already own this room
            if (Game.rooms[exitRoom] && 
                Game.rooms[exitRoom].controller && 
                Game.rooms[exitRoom].controller.my) {
                continue;
            }
            
            // Add to scout list if not already tracked
            if (!Memory.remoteOps.rooms[exitRoom]) {
                Memory.remoteOps.rooms[exitRoom] = {
                    baseRoom: room.name,
                    lastScout: 0,
                    sources: 0,
                    hostiles: false,
                    reservation: null
                };
            }
        }
    },
    
    /**
     * Update data for remote rooms
     */
    updateRemoteRooms: function() {
        // Process visible remote rooms
        for (const roomName in Memory.remoteOps.rooms) {
            // If room is visible, update data
            if (Game.rooms[roomName]) {
                const room = Game.rooms[roomName];
                const roomData = Memory.remoteOps.rooms[roomName];
                
                // Update last scout time
                roomData.lastScout = Game.time;
                
                // Count sources
                const sources = room.find(FIND_SOURCES);
                roomData.sources = sources.length;
                
                // Check for hostiles
                const hostiles = room.find(FIND_HOSTILE_CREEPS);
                roomData.hostiles = hostiles.length > 0;
                
                // Check controller reservation
                if (room.controller) {
                    if (room.controller.reservation) {
                        roomData.reservation = {
                            username: room.controller.reservation.username,
                            ticksToEnd: room.controller.reservation.ticksToEnd
                        };
                    } else {
                        roomData.reservation = null;
                    }
                }
                
                // Store source positions for future miners
                if (!roomData.sourcePositions && sources.length > 0) {
                    roomData.sourcePositions = sources.map(source => ({
                        id: source.id,
                        x: source.pos.x,
                        y: source.pos.y
                    }));
                }
            }
        }
        
        // Clean up old rooms that haven't been scouted in a long time
        const MAX_SCOUT_AGE = 20000; // About 16.6 hours
        for (const roomName in Memory.remoteOps.rooms) {
            const roomData = Memory.remoteOps.rooms[roomName];
            
            // Skip rooms that are actively being used
            if (roomData.mining || roomData.reserved) continue;
            
            // Remove very old scout data
            if (Game.time - roomData.lastScout > MAX_SCOUT_AGE) {
                delete Memory.remoteOps.rooms[roomName];
            }
        }
    },
    
    /**
     * Get the best remote room for harvesting
     * @param {string} baseRoomName - Name of the base room
     * @returns {string|null} - Name of the best remote room or null
     */
    getBestRemoteRoom: function(baseRoomName) {
        // Skip if not initialized
        if (!Memory.remoteOps || !Memory.remoteOps.rooms) return null;
        
        let bestRoom = null;
        let bestScore = -1;
        
        for (const roomName in Memory.remoteOps.rooms) {
            const roomData = Memory.remoteOps.rooms[roomName];
            
            // Skip if not connected to this base room
            if (roomData.baseRoom !== baseRoomName) continue;
            
            // Skip if has hostiles
            if (roomData.hostiles) continue;
            
            // Skip if reserved by someone else
            if (roomData.reservation && roomData.reservation.username !== Memory.username) continue;
            
            // Calculate score based on sources and distance
            const sources = roomData.sources || 0;
            if (sources === 0) continue;
            
            // Simple scoring for now - can be expanded
            const score = sources * 10;
            
            if (score > bestScore) {
                bestScore = score;
                bestRoom = roomName;
            }
        }
        
        return bestRoom;
    }
};

module.exports = remoteManager;