/**
 * Construction Manager - Handles structure placement and construction planning
 * CPU optimized for maximum efficiency
 */
const constructionManager = {
    /**
     * Run the construction manager for a room
     * @param {Room} room - The room to manage construction for
     */
    run: function(room) {
        const utils = require('utils');
        
        // Only run every 100 ticks to save CPU - construction is not time-critical
        // In emergency mode, run even less frequently
        const interval = global.emergencyMode ? 
            (global.emergencyMode.level === 'critical' ? 500 : 200) : 100;
            
        if (Game.time % interval !== 0) return;
        
        // Skip if we don't own the controller
        if (!room.controller || !room.controller.my) return;
        
        // Skip if CPU conditions don't allow for construction tasks
        if (!utils.shouldExecute('low')) return;
        
        // Initialize construction memory if needed
        if (!room.memory.construction) {
            room.memory.construction = {
                roads: { planned: false },
                extensions: { planned: false, count: 0 },
                lastUpdate: 0
            };
        }
        
        // Plan roads if not already planned
        if (!room.memory.construction.roads.planned) {
            this.planRoads(room);
            return; // Only do one major planning operation per tick
        }
        
        // Plan extensions if not already planned and we're at RCL 2+
        if (!room.memory.construction.extensions.planned && room.controller.level >= 2) {
            this.planExtensions(room);
            return; // Only do one major planning operation per tick
        }
        
        // Update construction sites
        this.createConstructionSites(room);
        
        // Update timestamp
        room.memory.construction.lastUpdate = Game.time;
    },
    
    /**
     * Plan roads for the room
     * @param {Room} room - The room to plan roads for
     */
    planRoads: function(room) {
        // Find spawn
        const spawns = room.find(FIND_MY_SPAWNS);
        if (spawns.length === 0) return;
        
        const spawn = spawns[0];
        
        // Find sources
        const sources = room.find(FIND_SOURCES);
        if (sources.length === 0) return;
        
        // Plan roads from spawn to each source
        const roads = new Set(); // Use Set to avoid duplicates
        
        // Path options optimized for road planning
        const pathOptions = {
            ignoreCreeps: true,
            swampCost: 2,
            plainCost: 1,
            maxOps: 2000, // Limit pathfinding operations
            serialize: false
        };
        
        for (const source of sources) {
            // Find path from spawn to source
            const path = room.findPath(spawn.pos, source.pos, pathOptions);
            
            // Add road positions to the plan
            for (const step of path) {
                roads.add(`${step.x},${step.y}`);
            }
        }
        
        // Plan road from spawn to controller
        const controllerPath = room.findPath(spawn.pos, room.controller.pos, pathOptions);
        
        for (const step of controllerPath) {
            roads.add(`${step.x},${step.y}`);
        }
        
        // Convert Set back to array of positions
        const roadPositions = [];
        for (const posKey of roads) {
            const [x, y] = posKey.split(',').map(Number);
            roadPositions.push({ x, y });
        }
        
        // Save road plan to memory
        room.memory.construction.roads = {
            planned: true,
            positions: roadPositions
        };
        
        console.log(`Planned ${roadPositions.length} road positions in room ${room.name}`);
    },
    
    /**
     * Plan extensions for the room
     * @param {Room} room - The room to plan extensions for
     */
    planExtensions: function(room) {
        // Find spawn
        const spawns = room.find(FIND_MY_SPAWNS);
        if (spawns.length === 0) return;
        
        const spawn = spawns[0];
        
        // Calculate how many extensions we can build at current RCL
        const maxExtensions = CONTROLLER_STRUCTURES.extension[room.controller.level];
        
        // Plan extension positions in a spiral pattern around spawn
        const extensions = [];
        const terrain = room.getTerrain();
        
        // Start with a small offset from spawn
        const startX = spawn.pos.x + 2;
        const startY = spawn.pos.y + 2;
        
        // Create a Set of road positions for faster lookups
        const roadPositions = new Set();
        if (room.memory.construction.roads && room.memory.construction.roads.positions) {
            for (const road of room.memory.construction.roads.positions) {
                roadPositions.add(`${road.x},${road.y}`);
            }
        }
        
        // Spiral pattern variables
        let x = startX;
        let y = startY;
        let dx = 0;
        let dy = -1;
        let maxSteps = 20; // Limit search radius
        let steps = 0;
        
        // Generate positions in a spiral
        while (extensions.length < maxExtensions && steps < maxSteps * maxSteps) {
            // Check if position is valid for an extension
            if (x >= 2 && x <= 47 && y >= 2 && y <= 47 && 
                terrain.get(x, y) !== TERRAIN_MASK_WALL) {
                
                // Check if position is not too close to other structures
                let validPos = true;
                
                // Don't place extensions on roads
                if (roadPositions.has(`${x},${y}`)) {
                    validPos = false;
                }
                
                // Don't place too close to sources or minerals
                if (validPos) {
                    const nearbyObjects = room.lookForAtArea(LOOK_SOURCES, y-1, x-1, y+1, x+1, true);
                    if (nearbyObjects.length > 0) {
                        validPos = false;
                    }
                }
                
                if (validPos) {
                    extensions.push({ x, y });
                }
            }
            
            // Move to next position in spiral
            if (x === y || (x < 0 && x === -y) || (x > 0 && x === 1-y)) {
                // Change direction
                const temp = dx;
                dx = -dy;
                dy = temp;
            }
            
            x += dx;
            y += dy;
            steps++;
        }
        
        // Save extension plan to memory
        room.memory.construction.extensions = {
            planned: true,
            positions: extensions,
            count: 0
        };
        
        console.log(`Planned ${extensions.length} extension positions in room ${room.name}`);
    },
    
    /**
     * Create construction sites based on plans
     * @param {Room} room - The room to create construction sites in
     */
    createConstructionSites: function(room) {
        // Check for global construction site limit
        const globalSiteCount = Object.keys(Game.constructionSites).length;
        const MAX_SITES_PER_ROOM = 5;
        const MAX_GLOBAL_SITES = 100; // Game limit is 100
        
        if (globalSiteCount >= MAX_GLOBAL_SITES) return;
        
        // Limit the number of construction sites to avoid CPU spikes
        const existingSites = room.find(FIND_CONSTRUCTION_SITES);
        if (existingSites.length >= MAX_SITES_PER_ROOM) return;
        
        // How many more sites we can place
        const sitesToPlace = Math.min(
            MAX_SITES_PER_ROOM - existingSites.length,
            MAX_GLOBAL_SITES - globalSiteCount
        );
        let sitesPlaced = 0;
        
        // Create a map of existing structures for faster lookups
        const structureMap = new Map();
        const structures = room.find(FIND_STRUCTURES);
        for (const structure of structures) {
            const key = `${structure.pos.x},${structure.pos.y},${structure.structureType}`;
            structureMap.set(key, true);
        }
        
        // Create a map of existing construction sites for faster lookups
        const siteMap = new Map();
        for (const site of existingSites) {
            const key = `${site.pos.x},${site.pos.y},${site.structureType}`;
            siteMap.set(key, true);
        }
        
        // Create road construction sites first
        if (room.memory.construction.roads && 
            room.memory.construction.roads.planned && 
            room.memory.construction.roads.positions) {
            
            const roadPositions = room.memory.construction.roads.positions;
            const newRoadPositions = [];
            
            for (let i = 0; i < roadPositions.length && sitesPlaced < sitesToPlace; i++) {
                const pos = roadPositions[i];
                
                // Check if there's already a road or construction site here
                const roadKey = `${pos.x},${pos.y},${STRUCTURE_ROAD}`;
                const hasRoad = structureMap.has(roadKey);
                const hasRoadSite = siteMap.has(roadKey);
                
                // Create road construction site if needed
                if (!hasRoad && !hasRoadSite) {
                    const result = room.createConstructionSite(pos.x, pos.y, STRUCTURE_ROAD);
                    if (result === OK) {
                        sitesPlaced++;
                    }
                }
                
                // Keep this position in the plan if road doesn't exist yet
                if (!hasRoad) {
                    newRoadPositions.push(pos);
                }
            }
            
            // Update road positions in memory
            room.memory.construction.roads.positions = newRoadPositions;
        }
        
        // Create extension construction sites if we have capacity
        if (room.controller.level >= 2 && 
            room.memory.construction.extensions && 
            room.memory.construction.extensions.planned && 
            room.memory.construction.extensions.positions) {
            
            const extensionPositions = room.memory.construction.extensions.positions;
            const maxExtensions = CONTROLLER_STRUCTURES.extension[room.controller.level];
            const currentExtensions = room.memory.construction.extensions.count || 0;
            const newExtensionPositions = [];
            
            // Only create extensions if we haven't reached the limit
            if (currentExtensions < maxExtensions) {
                let newExtensionsCount = 0;
                
                for (let i = 0; i < extensionPositions.length && sitesPlaced < sitesToPlace; i++) {
                    const pos = extensionPositions[i];
                    
                    // Check if there's already an extension or construction site here
                    const extensionKey = `${pos.x},${pos.y},${STRUCTURE_EXTENSION}`;
                    const hasExtension = structureMap.has(extensionKey);
                    const hasExtensionSite = siteMap.has(extensionKey);
                    
                    // Create extension construction site if needed
                    if (!hasExtension && !hasExtensionSite && currentExtensions + newExtensionsCount < maxExtensions) {
                        const result = room.createConstructionSite(pos.x, pos.y, STRUCTURE_EXTENSION);
                        if (result === OK) {
                            sitesPlaced++;
                            newExtensionsCount++;
                        }
                    }
                    
                    // Keep this position in the plan if extension doesn't exist yet
                    if (!hasExtension) {
                        newExtensionPositions.push(pos);
                    } else {
                        room.memory.construction.extensions.count = (room.memory.construction.extensions.count || 0) + 1;
                    }
                }
                
                // Update extension positions in memory
                room.memory.construction.extensions.positions = newExtensionPositions;
            }
        }
    }
};

module.exports = constructionManager;