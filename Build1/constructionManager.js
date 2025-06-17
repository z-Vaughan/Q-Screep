/**
 * Construction Manager - Handles structure placement and construction planning
 * CPU optimized for maximum efficiency
 */
const utils = require('utils');

// Original module implementation
const constructionManagerImpl = {
    /**
     * Run the construction manager for a room
     * @param {Room} room - The room to manage construction for
     * @param {boolean} force - Force run regardless of interval
     */
    run: function(room, force = false) {
        const utils = require('utils');
        
        // Check if we're in a simulation room
        const isSimulation = room.name.startsWith('sim');
        
        // Always update construction site count for roomManager
        this.updateConstructionSiteCount(room);
        
        // Run more frequently in simulation rooms
        const interval = isSimulation ? 5 : // Every 5 ticks in simulation
            (global.emergencyMode ? 
                (global.emergencyMode.level === 'critical' ? 500 : 200) : 100);
            
        if (!force && Game.time % interval !== 0) return;
        
        // Skip if we don't own the controller
        if (!room.controller || !room.controller.my) return;
        
        // Skip if CPU conditions don't allow for construction tasks
        if (!utils.shouldExecute('low')) return;
        
        // Check if room has evolved and needs plan updates
        this.checkRoomEvolution(room);
        
        // Initialize construction memory if needed
        if (!room.memory.construction) {
            room.memory.construction = {
                roads: { planned: false },
                extensions: { planned: false, count: 0 },
                containers: { planned: false },
                storage: { planned: false },
                towers: { planned: false, count: 0 },
                lastUpdate: 0
            };
        }
        
        // Ensure all required construction memory properties exist
        if (!room.memory.construction.roads) room.memory.construction.roads = { planned: false };
        if (!room.memory.construction.extensions) room.memory.construction.extensions = { planned: false, count: 0 };
        if (!room.memory.construction.containers) room.memory.construction.containers = { planned: false };
        if (!room.memory.construction.storage) room.memory.construction.storage = { planned: false };
        if (!room.memory.construction.towers) room.memory.construction.towers = { planned: false, count: 0 };
        
        // Plan roads if not already planned
        if (!room.memory.construction.roads || !room.memory.construction.roads.planned) {
            console.log(`Planning roads in room ${room.name}`);
            this.planRoads(room);
            return; // Only do one major planning operation per tick
        }
        
        // Plan containers if not already planned
        if (!room.memory.construction.containers || !room.memory.construction.containers.planned) {
            console.log(`Planning containers in room ${room.name}`);
            this.planContainers(room);
            return; // Only do one major planning operation per tick
        }
        
        // Plan extensions if not already planned and we're at RCL 2+
        if ((!room.memory.construction.extensions || !room.memory.construction.extensions.planned) && room.controller.level >= 2) {
            console.log(`Planning extensions in room ${room.name} (RCL: ${room.controller.level})`);
            this.planExtensions(room);
            return; // Only do one major planning operation per tick
        }
        
        // Plan towers if not already planned and we're at RCL 3+
        if ((!room.memory.construction.towers || !room.memory.construction.towers.planned) && room.controller.level >= 3) {
            this.planTowers(room);
            return; // Only do one major planning operation per tick
        }
        
        // Plan storage if not already planned and we're at RCL 4+
        if ((!room.memory.construction.storage || !room.memory.construction.storage.planned) && room.controller.level >= 4) {
            this.planStorage(room);
            return; // Only do one major planning operation per tick
        }
        
        // Update construction sites
        this.createConstructionSites(room);
        
        // Update timestamp
        room.memory.construction.lastUpdate = Game.time;
        
        // Log construction status
        /*
        if (force || Game.time % (isSimulation ? 20 : 100) === 0) {
            console.log(`Construction status for ${room.name}: ` +
                `Roads: ${room.memory.construction.roads.planned ? 'Planned' : 'Not Planned'}, ` +
                `Extensions: ${room.memory.construction.extensions.planned ? 'Planned' : 'Not Planned'}, ` +
                `Containers: ${room.memory.construction.containers?.planned ? 'Planned' : 'Not Planned'}, ` +
                `RCL: ${room.controller.level}`
            );
            
            // In simulation, log more detailed information
            if (isSimulation) {
                console.log(`Simulation construction details: ` +
                    `Tick: ${Game.time}, ` +
                    `CPU Bucket: ${Game.cpu.bucket}, ` +
                    `shouldExecute('low'): ${utils.shouldExecute('low')}, ` +
                    `Construction sites: ${room.find(FIND_CONSTRUCTION_SITES).length}`
                );
            }
        }
        */
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
        
        // Plan extension positions
        const extensions = [];
        const terrain = room.getTerrain();
        
        // Create a Set of road positions for faster lookups
        const roadPositions = new Set();
        if (room.memory.construction.roads && room.memory.construction.roads.positions) {
            for (const road of room.memory.construction.roads.positions) {
                roadPositions.add(`${road.x},${road.y}`);
            }
        }
        
        // Find existing structures to avoid
        const existingStructures = room.find(FIND_STRUCTURES);
        const structurePositions = new Set();
        for (const structure of existingStructures) {
            structurePositions.add(`${structure.pos.x},${structure.pos.y}`);
        }
        
        // Find sources and minerals to avoid
        const sources = room.find(FIND_SOURCES);
        const minerals = room.find(FIND_MINERALS);
        const avoidPositions = [...sources, ...minerals].map(s => s.pos);
        
        // Find the room center for scoring
        const roomCenterX = 25;
        const roomCenterY = 25;
        
        // Create a cost matrix for pathfinding
        const costMatrix = new PathFinder.CostMatrix();
        
        // Mark all walls as unwalkable
        for (let x = 0; x < 50; x++) {
            for (let y = 0; y < 50; y++) {
                if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
                    costMatrix.set(x, y, 255);
                }
            }
        }
        
        // Mark existing structures as unwalkable
        for (const structure of existingStructures) {
            if (structure.structureType !== STRUCTURE_ROAD) {
                costMatrix.set(structure.pos.x, structure.pos.y, 255);
            }
        }
        
        // Mark areas around sources and minerals as unwalkable
        for (const pos of avoidPositions) {
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    const x = pos.x + dx;
                    const y = pos.y + dy;
                    if (x >= 0 && x < 50 && y >= 0 && y < 50) {
                        costMatrix.set(x, y, 255);
                    }
                }
            }
        }
        
        // Generate candidate positions
        const candidates = [];
        
        // Try multiple strategies for extension placement
        
        // Strategy 1: Cluster around spawn
        this.generateClusterCandidates(spawn.pos, 2, 8, candidates, costMatrix, roadPositions);
        
        // Strategy 2: Place along roads
        this.generateRoadAdjacentCandidates(room, roadPositions, candidates, costMatrix);
        
        // Strategy 3: Find open areas
        this.generateOpenAreaCandidates(room, spawn.pos, candidates, costMatrix, roadPositions);
        
        // Score and sort candidates
        for (const candidate of candidates) {
            // Base score - prefer positions closer to spawn but not too close
            const distToSpawn = Math.abs(candidate.x - spawn.pos.x) + Math.abs(candidate.y - spawn.pos.y);
            candidate.score = 100 - Math.min(distToSpawn, 20);
            
            // Bonus for being near roads but not on them
            let nearRoad = false;
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    if (dx === 0 && dy === 0) continue;
                    const roadKey = `${candidate.x + dx},${candidate.y + dy}`;
                    if (roadPositions.has(roadKey)) {
                        nearRoad = true;
                        break;
                    }
                }
            }
            if (nearRoad) candidate.score += 20;
            
            // Penalty for being far from center
            const distToCenter = Math.abs(candidate.x - roomCenterX) + Math.abs(candidate.y - roomCenterY);
            candidate.score -= Math.min(distToCenter / 2, 15);
            
            // Bonus for being near other extensions (clustering)
            let nearbyExtensions = 0;
            for (const ext of extensions) {
                const dist = Math.abs(candidate.x - ext.x) + Math.abs(candidate.y - ext.y);
                if (dist <= 2) nearbyExtensions++;
            }
            candidate.score += nearbyExtensions * 5;
        }
        
        // Sort by score (highest first)
        candidates.sort((a, b) => b.score - a.score);
        
        // Take the best positions up to maxExtensions
        for (let i = 0; i < candidates.length && extensions.length < maxExtensions; i++) {
            const pos = candidates[i];
            
            // Final validation
            if (pos.x >= 2 && pos.x <= 47 && pos.y >= 2 && pos.y <= 47 && 
                terrain.get(pos.x, pos.y) !== TERRAIN_MASK_WALL &&
                !roadPositions.has(`${pos.x},${pos.y}`) &&
                !structurePositions.has(`${pos.x},${pos.y}`)) {
                
                extensions.push({ x: pos.x, y: pos.y });
                
                // Mark this position as taken
                structurePositions.add(`${pos.x},${pos.y}`);
            }
        }
        
        // If we still don't have enough extensions, fall back to spiral pattern
        if (extensions.length < maxExtensions) {
            this.planExtensionsSpiral(room, spawn, extensions, maxExtensions, roadPositions, structurePositions);
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
     * Generate candidate positions in clusters around a point
     */
    generateClusterCandidates: function(centerPos, minRange, maxRange, candidates, costMatrix, roadPositions) {
        for (let dx = -maxRange; dx <= maxRange; dx++) {
            for (let dy = -maxRange; dy <= maxRange; dy++) {
                const dist = Math.abs(dx) + Math.abs(dy);
                if (dist < minRange || dist > maxRange) continue;
                
                const x = centerPos.x + dx;
                const y = centerPos.y + dy;
                
                // Skip if out of bounds or unwalkable
                if (x < 2 || x > 47 || y < 2 || y > 47 || costMatrix.get(x, y) === 255) continue;
                
                // Skip if on a road
                if (roadPositions.has(`${x},${y}`)) continue;
                
                // Add as candidate
                candidates.push({ x, y });
            }
        }
    },
    
    /**
     * Generate candidate positions adjacent to roads
     */
    generateRoadAdjacentCandidates: function(room, roadPositions, candidates, costMatrix) {
        // Check positions adjacent to roads
        for (const roadPosKey of roadPositions) {
            const [roadX, roadY] = roadPosKey.split(',').map(Number);
            
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    if (dx === 0 && dy === 0) continue; // Skip the road itself
                    
                    const x = roadX + dx;
                    const y = roadY + dy;
                    
                    // Skip if out of bounds or unwalkable
                    if (x < 2 || x > 47 || y < 2 || y > 47 || costMatrix.get(x, y) === 255) continue;
                    
                    // Skip if on another road
                    if (roadPositions.has(`${x},${y}`)) continue;
                    
                    // Add as candidate
                    candidates.push({ x, y });
                }
            }
        }
    },
    
    /**
     * Generate candidate positions in open areas
     */
    generateOpenAreaCandidates: function(room, centerPos, candidates, costMatrix, roadPositions) {
        // Find open areas with good connectivity
        for (let x = 5; x < 45; x += 2) {
            for (let y = 5; y < 45; y += 2) {
                // Skip if unwalkable
                if (costMatrix.get(x, y) === 255) continue;
                
                // Skip if on a road
                if (roadPositions.has(`${x},${y}`)) continue;
                
                // Check open space around this position
                let openSpace = 0;
                for (let dx = -2; dx <= 2; dx++) {
                    for (let dy = -2; dy <= 2; dy++) {
                        const nx = x + dx;
                        const ny = y + dy;
                        if (nx >= 0 && nx < 50 && ny >= 0 && ny < 50 && costMatrix.get(nx, ny) !== 255) {
                            openSpace++;
                        }
                    }
                }
                
                // Only consider positions with good open space
                if (openSpace >= 15) {
                    candidates.push({ x, y });
                }
            }
        }
    },
    
    /**
     * Fall back to spiral pattern for extension placement
     */
    planExtensionsSpiral: function(room, spawn, extensions, maxExtensions, roadPositions, structurePositions) {
        const terrain = room.getTerrain();
        
        // Start with a small offset from spawn
        const startX = spawn.pos.x + 2;
        const startY = spawn.pos.y + 2;
        
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
                terrain.get(x, y) !== TERRAIN_MASK_WALL &&
                !roadPositions.has(`${x},${y}`) &&
                !structurePositions.has(`${x},${y}`)) {
                
                // Don't place too close to sources or minerals
                let validPos = true;
                const nearbyObjects = room.lookForAtArea(LOOK_SOURCES, y-1, x-1, y+1, x+1, true);
                if (nearbyObjects.length > 0) {
                    validPos = false;
                }
                
                if (validPos) {
                    extensions.push({ x, y });
                    structurePositions.add(`${x},${y}`);
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
    },
    
    /**
     * Check if a position is safe from source keepers
     * @param {Room} room - The room to check
     * @param {RoomPosition|Object} pos - Position to check
     * @param {number} safeDistance - Safe distance from keeper lairs
     * @returns {boolean} - True if position is safe
     */
    isSafeFromSourceKeepers: function(room, pos, safeDistance = 5) {
        // Find all source keeper lairs in the room
        const keeperLairs = room.find(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_KEEPER_LAIR
        });
        
        // If no keeper lairs, position is safe
        if (keeperLairs.length === 0) return true;
        
        // Check distance to each keeper lair
        for (const lair of keeperLairs) {
            const distance = Math.abs(lair.pos.x - pos.x) + Math.abs(lair.pos.y - pos.y);
            if (distance <= safeDistance) {
                return false; // Too close to a keeper lair
            }
        }
        
        return true; // Safe from all keeper lairs
    },
    
    /**
     * Plan containers for the room
     * @param {Room} room - The room to plan containers for
     */
    planContainers: function(room) {
        // Find sources
        const sources = room.find(FIND_SOURCES);
        if (sources.length === 0) return;
        
        const containers = [];
        const terrain = room.getTerrain();
        
        // Plan container near each source
        for (const source of sources) {
            // Skip sources near source keeper lairs
            if (!this.isSafeFromSourceKeepers(room, source.pos, 5)) {
                console.log(`Skipping container planning for source at (${source.pos.x},${source.pos.y}) - too close to source keeper lair`);
                continue;
            }
            
            // Find the best position for a container near the source
            let bestPos = null;
            let bestScore = -1;
            
            // Check positions around the source
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    // Skip the source position itself
                    if (dx === 0 && dy === 0) continue;
                    
                    const x = source.pos.x + dx;
                    const y = source.pos.y + dy;
                    
                    // Skip if out of bounds or on a wall
                    if (x <= 0 || y <= 0 || x >= 49 || y >= 49 || 
                        terrain.get(x, y) === TERRAIN_MASK_WALL) {
                        continue;
                    }
                    
                    // Calculate score based on adjacent walkable tiles
                    let score = 0;
                    for (let nx = -1; nx <= 1; nx++) {
                        for (let ny = -1; ny <= 1; ny++) {
                            const ax = x + nx;
                            const ay = y + ny;
                            if (ax >= 0 && ay >= 0 && ax < 50 && ay < 50 && 
                                terrain.get(ax, ay) !== TERRAIN_MASK_WALL) {
                                score++;
                            }
                        }
                    }
                    
                    // Higher score means more accessible position
                    if (score > bestScore) {
                        bestScore = score;
                        bestPos = { x, y };
                    }
                }
            }
            
            // Add the best position if found
            if (bestPos) {
                containers.push(bestPos);
            }
        }
        
        // Plan container near controller
        const controllerContainer = this.findControllerContainerPosition(room);
        if (controllerContainer) {
            containers.push(controllerContainer);
        }
        
        // Save container plan to memory
        room.memory.construction.containers = {
            planned: true,
            positions: containers
        };
        
        console.log(`Planned ${containers.length} container positions in room ${room.name}`);
    },
    
    /**
     * Plan towers for the room
     * @param {Room} room - The room to plan towers for
     */
    planTowers: function(room) {
        // Skip if below RCL 3
        if (room.controller.level < 3) return;
        
        // Find spawn
        const spawns = room.find(FIND_MY_SPAWNS);
        if (spawns.length === 0) return;
        
        const spawn = spawns[0];
        const terrain = room.getTerrain();
        
        // Calculate how many towers we can build at current RCL
        const maxTowers = CONTROLLER_STRUCTURES[STRUCTURE_TOWER][room.controller.level];
        const towers = [];
        
        // First tower: close to spawn for early defense
        const firstTowerPos = this.findTowerPosition(room, spawn.pos, 3, 5);
        if (firstTowerPos) {
            towers.push(firstTowerPos);
        }
        
        // Additional towers: strategic positions if RCL allows
        if (maxTowers >= 2 && room.controller.level >= 5) {
            // Second tower: near room center for better coverage
            const centerX = 25;
            const centerY = 25;
            const centerPos = new RoomPosition(centerX, centerY, room.name);
            const secondTowerPos = this.findTowerPosition(room, centerPos, 5, 10, towers);
            
            if (secondTowerPos) {
                towers.push(secondTowerPos);
            }
        }
        
        // Save tower plan to memory
        room.memory.construction.towers = {
            planned: true,
            positions: towers,
            count: 0
        };
        
        console.log(`Planned ${towers.length} tower positions in room ${room.name}`);
    },
    
    /**
     * Find a good position for a tower
     * @param {Room} room - The room to check
     * @param {RoomPosition} anchorPos - Position to search around
     * @param {number} minRange - Minimum range from anchor
     * @param {number} maxRange - Maximum range from anchor
     * @param {Array} existingPositions - Positions to avoid
     * @returns {Object|null} - Position object or null if no valid position
     */
    findTowerPosition: function(room, anchorPos, minRange, maxRange, existingPositions = []) {
        const terrain = room.getTerrain();
        let bestPos = null;
        let bestScore = -1;
        
        // Check positions in a square around the anchor
        for (let dx = -maxRange; dx <= maxRange; dx++) {
            for (let dy = -maxRange; dy <= maxRange; dy++) {
                const x = anchorPos.x + dx;
                const y = anchorPos.y + dy;
                
                // Skip if out of bounds or on a wall
                if (x <= 2 || y <= 2 || x >= 47 || y >= 47 || 
                    terrain.get(x, y) === TERRAIN_MASK_WALL) {
                    continue;
                }
                
                // Calculate Manhattan distance
                const distance = Math.abs(dx) + Math.abs(dy);
                
                // Skip if too close or too far
                if (distance < minRange || distance > maxRange) {
                    continue;
                }
                
                // Skip if too close to existing positions
                let tooClose = false;
                for (const pos of existingPositions) {
                    if (Math.abs(pos.x - x) + Math.abs(pos.y - y) < 3) {
                        tooClose = true;
                        break;
                    }
                }
                if (tooClose) continue;
                
                // Calculate score based on open space and distance
                let score = 0;
                
                // Prefer positions with open space around them
                for (let nx = -1; nx <= 1; nx++) {
                    for (let ny = -1; ny <= 1; ny++) {
                        const ax = x + nx;
                        const ay = y + ny;
                        if (ax >= 0 && ay >= 0 && ax < 50 && ay < 50 && 
                            terrain.get(ax, ay) !== TERRAIN_MASK_WALL) {
                            score++;
                        }
                    }
                }
                
                // Adjust score based on distance (prefer middle of range)
                const distanceScore = maxRange - Math.abs(distance - (minRange + maxRange) / 2);
                score += distanceScore;
                
                if (score > bestScore) {
                    bestScore = score;
                    bestPos = { x, y };
                }
            }
        }
        
        return bestPos;
    },
    
    /**
     * Plan storage placement for the room
     * @param {Room} room - The room to plan storage for
     */
    planStorage: function(room) {
        // Skip if below RCL 4
        if (room.controller.level < 4) return;
        
        // Find spawn
        const spawns = room.find(FIND_MY_SPAWNS);
        if (spawns.length === 0) return;
        
        const spawn = spawns[0];
        const terrain = room.getTerrain();
        
        // Find a good position for storage near spawn
        let storagePos = null;
        let bestScore = -1;
        
        // Check positions in a radius around spawn
        for (let dx = -5; dx <= 5; dx++) {
            for (let dy = -5; dy <= 5; dy++) {
                // Skip positions too close or too far
                const dist = Math.abs(dx) + Math.abs(dy);
                if (dist < 2 || dist > 6) continue;
                
                const x = spawn.pos.x + dx;
                const y = spawn.pos.y + dy;
                
                // Skip if out of bounds or on a wall
                if (x <= 2 || y <= 2 || x >= 47 || y >= 47 || 
                    terrain.get(x, y) === TERRAIN_MASK_WALL) {
                    continue;
                }
                
                // Calculate score based on open space and distance
                let score = 10 - dist; // Prefer closer positions
                
                // Add score for adjacent walkable tiles
                for (let nx = -1; nx <= 1; nx++) {
                    for (let ny = -1; ny <= 1; ny++) {
                        const ax = x + nx;
                        const ay = y + ny;
                        if (ax >= 0 && ay >= 0 && ax < 50 && ay < 50 && 
                            terrain.get(ax, ay) !== TERRAIN_MASK_WALL) {
                            score++;
                        }
                    }
                }
                
                // Check if position is on a road or near planned extensions
                const lookResult = room.lookAt(x, y);
                for (const item of lookResult) {
                    if (item.type === LOOK_STRUCTURES && 
                        (item.structure.structureType === STRUCTURE_ROAD || 
                         item.structure.structureType === STRUCTURE_EXTENSION)) {
                        score -= 5; // Penalize positions on roads or near extensions
                    }
                }
                
                if (score > bestScore) {
                    bestScore = score;
                    storagePos = { x, y };
                }
            }
        }
        
        // Save storage plan to memory
        room.memory.construction.storage = {
            planned: true,
            position: storagePos
        };
        
        if (storagePos) {
            console.log(`Planned storage position at (${storagePos.x},${storagePos.y}) in room ${room.name}`);
        } else {
            console.log(`Could not find suitable storage position in room ${room.name}`);
        }
    },
    
    /**
     * Check if room has evolved and needs plan updates
     * @param {Room} room - The room to check
     */
    checkRoomEvolution: function(room) {
        // Skip if no construction memory
        if (!room.memory.construction) return;
        
        // Track the last RCL we planned for
        if (!room.memory.construction.lastRCL) {
            room.memory.construction.lastRCL = room.controller.level;
        }
        
        // If RCL has increased, reset some plans to adapt to new capabilities
        if (room.controller.level > room.memory.construction.lastRCL) {
            console.log(`Room ${room.name} evolved from RCL ${room.memory.construction.lastRCL} to ${room.controller.level}, updating construction plans`);
            
            // Reset extension planning when reaching RCL 2, 3, 4, etc.
            if ((room.controller.level >= 2 && room.memory.construction.lastRCL < 2) ||
                (room.controller.level >= 3 && room.memory.construction.lastRCL < 3) ||
                (room.controller.level >= 4 && room.memory.construction.lastRCL < 4)) {
                room.memory.construction.extensions.planned = false;
            }
            
            // Reset tower planning when reaching RCL 3, 5, 7
            if ((room.controller.level >= 3 && room.memory.construction.lastRCL < 3) ||
                (room.controller.level >= 5 && room.memory.construction.lastRCL < 5) ||
                (room.controller.level >= 7 && room.memory.construction.lastRCL < 7)) {
                room.memory.construction.towers.planned = false;
            }
            
            // Update the last RCL
            room.memory.construction.lastRCL = room.controller.level;
        }
        
        // Periodically check if we need to replan roads (every 1000 ticks)
        if (Game.time % 1000 === 0 && room.memory.construction.roads && room.memory.construction.roads.planned) {
            // Count existing roads
            const roads = room.find(FIND_STRUCTURES, {
                filter: s => s.structureType === STRUCTURE_ROAD
            });
            
            // If we have very few roads compared to plan, something might be wrong
            if (roads.length < room.memory.construction.roads.positions.length * 0.5) {
                console.log(`Room ${room.name} has fewer roads than expected, replanning roads`);
                room.memory.construction.roads.planned = false;
            }
        }
    },
    
    // Note: Removed duplicate planStorage and findTowerPosition functions
    
    /**
     * Update the construction site count in room memory
     * @param {Room} room - The room to update
     */
    updateConstructionSiteCount: function(room) {
        // Find all construction sites in the room
        const sites = room.find(FIND_CONSTRUCTION_SITES);
        
        // Update room memory
        room.memory.constructionSites = sites.length;
        room.memory.constructionSiteIds = sites.map(site => site.id);
        
        // Check if we need to create more sites
        const TARGET_SITES_PER_ROOM = 5;
        if (sites.length < TARGET_SITES_PER_ROOM && 
            (!room.memory.construction.lastUpdate || Game.time - room.memory.construction.lastUpdate >= 20)) {
            // Force a construction site creation check soon
            room.memory.construction.lastUpdate = Game.time - 95; // Will trigger in 5 ticks
        }
    },
    
    /**
     * Find the best position for a container near the controller
     * @param {Room} room - The room to check
     * @returns {Object|null} - Position object or null if no valid position
     */
    findControllerContainerPosition: function(room) {
        const controller = room.controller;
        if (!controller) return null;
        
        const terrain = room.getTerrain();
        let bestPos = null;
        let bestScore = -1;
        
        // Check positions around the controller
        for (let dx = -2; dx <= 2; dx++) {
            for (let dy = -2; dy <= 2; dy++) {
                // Skip positions too close or too far
                const dist = Math.abs(dx) + Math.abs(dy);
                if (dist < 1 || dist > 3) continue;
                
                const x = controller.pos.x + dx;
                const y = controller.pos.y + dy;
                
                // Skip if out of bounds or on a wall
                if (x <= 0 || y <= 0 || x >= 49 || y >= 49 || 
                    terrain.get(x, y) === TERRAIN_MASK_WALL) {
                    continue;
                }
                
                // Calculate score based on distance and adjacent walkable tiles
                let score = 4 - dist; // Prefer closer positions
                
                // Add score for adjacent walkable tiles
                for (let nx = -1; nx <= 1; nx++) {
                    for (let ny = -1; ny <= 1; ny++) {
                        const ax = x + nx;
                        const ay = y + ny;
                        if (ax >= 0 && ay >= 0 && ax < 50 && ay < 50 && 
                            terrain.get(ax, ay) !== TERRAIN_MASK_WALL) {
                            score++;
                        }
                    }
                }
                
                if (score > bestScore) {
                    bestScore = score;
                    bestPos = { x, y };
                }
            }
        }
        
        return bestPos;
    },
    

    
    /**
     * Create construction sites based on plans
     * @param {Room} room - The room to create construction sites in
     */
    createConstructionSites: function(room) {
        // Check for global construction site limit
        const globalSiteCount = Object.keys(Game.constructionSites).length;
        const TARGET_SITES_PER_ROOM = 5; // We want to maintain 5 sites at all times
        const MAX_GLOBAL_SITES = 100; // Game limit is 100
        
        if (globalSiteCount >= MAX_GLOBAL_SITES) return;
        
        // Count existing construction sites in this room
        const existingSites = room.find(FIND_CONSTRUCTION_SITES);
        
        // If we already have enough sites, no need to create more
        if (existingSites.length >= TARGET_SITES_PER_ROOM) {
            // Update room memory with current construction site count and IDs
            room.memory.constructionSites = existingSites.length;
            room.memory.constructionSiteIds = existingSites.map(site => site.id);
            return;
        }
        
        // How many more sites we need to place to reach our target
        const sitesToPlace = Math.min(
            TARGET_SITES_PER_ROOM - existingSites.length,
            MAX_GLOBAL_SITES - globalSiteCount
        );
        
        console.log(`Room ${room.name} has ${existingSites.length} construction sites, creating ${sitesToPlace} more to reach target of ${TARGET_SITES_PER_ROOM}`);
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
        
        // Create container construction sites first (highest priority)
        if (room.memory.construction && room.memory.construction.containers && 
            room.memory.construction.containers.planned && 
            room.memory.construction.containers.positions) {
            
            const containerPositions = room.memory.construction.containers.positions;
            const newContainerPositions = [];
            
            for (let i = 0; i < containerPositions.length && sitesPlaced < sitesToPlace; i++) {
                const pos = containerPositions[i];
                
                // Check if there's already a container or construction site here
                const containerKey = `${pos.x},${pos.y},${STRUCTURE_CONTAINER}`;
                const hasContainer = structureMap.has(containerKey);
                const hasContainerSite = siteMap.has(containerKey);
                
                // Create container construction site if needed
                if (!hasContainer && !hasContainerSite) {
                    const result = room.createConstructionSite(pos.x, pos.y, STRUCTURE_CONTAINER);
                    if (result === OK) {
                        sitesPlaced++;
                        console.log(`Created container construction site at (${pos.x},${pos.y})`);
                        
                        // Add to site map to prevent duplicates
                        siteMap.set(containerKey, true);
                    }
                }
                
                // Keep this position in the plan if container doesn't exist yet
                if (!hasContainer) {
                    newContainerPositions.push(pos);
                }
            }
            
            // Update container positions in memory
            room.memory.construction.containers.positions = newContainerPositions;
        }
        
        // Create extension construction sites next (second priority)
        if (room.controller.level >= 2 && room.memory.construction && 
            room.memory.construction.extensions && 
            room.memory.construction.extensions.planned && 
            room.memory.construction.extensions.positions && sitesPlaced < sitesToPlace) {
            
            const extensionPositions = room.memory.construction.extensions.positions;
            const maxExtensions = CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][room.controller.level];
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
                            console.log(`Created extension construction site at (${pos.x},${pos.y})`);
                            
                            // Add to site map to prevent duplicates
                            siteMap.set(extensionKey, true);
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
        
        // Create road construction sites after containers and extensions (third priority)
        if (room.memory.construction && room.memory.construction.roads && 
            room.memory.construction.roads.planned && 
            room.memory.construction.roads.positions && sitesPlaced < sitesToPlace) {
            
            const roadPositions = room.memory.construction.roads.positions;
            const newRoadPositions = [];
            
            // Log the number of road positions to process
            console.log(`Processing ${roadPositions.length} road positions in room ${room.name}`);
            
            // Track how many positions we've checked
            let positionsChecked = 0;
            let positionsSkipped = 0;
            
            for (let i = 0; i < roadPositions.length && sitesPlaced < sitesToPlace; i++) {
                positionsChecked++;
                const pos = roadPositions[i];
                
                // Validate position
                if (!pos || pos.x === undefined || pos.y === undefined) {
                    console.log(`Invalid road position at index ${i}: ${JSON.stringify(pos)}`);
                    continue;
                }
                
                // Check if position is valid (within bounds)
                if (pos.x < 0 || pos.x > 49 || pos.y < 0 || pos.y > 49) {
                    console.log(`Road position out of bounds: (${pos.x},${pos.y})`);
                    continue;
                }
                
                // Check if there's already a road or construction site here
                const roadKey = `${pos.x},${pos.y},${STRUCTURE_ROAD}`;
                const hasRoad = structureMap.has(roadKey);
                const hasRoadSite = siteMap.has(roadKey);
                
                // Skip if already built or under construction
                if (hasRoad || hasRoadSite) {
                    positionsSkipped++;
                    // Keep this position in the plan if road doesn't exist yet
                    if (!hasRoad) {
                        newRoadPositions.push(pos);
                    }
                    continue;
                }
                
                // Check for any other structures or sites at this position
                const lookResult = room.lookAt(pos.x, pos.y);
                let hasStructure = false;
                
                for (const item of lookResult) {
                    if (item.type === LOOK_STRUCTURES || item.type === LOOK_CONSTRUCTION_SITES) {
                        hasStructure = true;
                        break;
                    }
                }
                
                if (hasStructure) {
                    positionsSkipped++;
                    continue;
                }
                
                // Create road construction site
                try {
                    const result = room.createConstructionSite(pos.x, pos.y, STRUCTURE_ROAD);
                    if (result === OK) {
                        sitesPlaced++;
                        console.log(`Created road construction site at (${pos.x},${pos.y})`);
                        
                        // Add to site map to prevent duplicates
                        siteMap.set(roadKey, true);
                    } else {
                        console.log(`Failed to create road construction site at (${pos.x},${pos.y}), result: ${result}`);
                        
                        // Common error codes:
                        // ERR_INVALID_TARGET = -7
                        // ERR_FULL = -8 (too many construction sites)
                        // ERR_RCL_NOT_ENOUGH = -14
                        
                        if (result === ERR_FULL) {
                            console.log(`Construction site limit reached (${sitesPlaced} placed)`);
                            break;
                        }
                    }
                } catch (e) {
                    console.log(`Exception creating road site at (${pos.x},${pos.y}): ${e}`);
                }
                
                // Keep this position in the plan for next time
                newRoadPositions.push(pos);
            }
            
            // Log summary
            console.log(`Road positions: ${positionsChecked} checked, ${positionsSkipped} skipped, ${sitesPlaced} sites placed`);
            
            // Update road positions in memory
            room.memory.construction.roads.positions = newRoadPositions;
        }
        
        // Extensions are now created before roads
        
        // Create tower construction sites if we have capacity
        if (room.controller.level >= 3 && room.memory.construction && 
            room.memory.construction.towers && 
            room.memory.construction.towers.planned && 
            room.memory.construction.towers.positions) {
            
            const towerPositions = room.memory.construction.towers.positions;
            const maxTowers = CONTROLLER_STRUCTURES[STRUCTURE_TOWER][room.controller.level];
            const currentTowers = room.memory.construction.towers.count || 0;
            const newTowerPositions = [];
            
            // Only create towers if we haven't reached the limit
            if (currentTowers < maxTowers) {
                let newTowersCount = 0;
                
                for (let i = 0; i < towerPositions.length && sitesPlaced < sitesToPlace; i++) {
                    const pos = towerPositions[i];
                    
                    // Check if there's already a tower or construction site here
                    const towerKey = `${pos.x},${pos.y},${STRUCTURE_TOWER}`;
                    const hasTower = structureMap.has(towerKey);
                    const hasTowerSite = siteMap.has(towerKey);
                    
                    // Create tower construction site if needed
                    if (!hasTower && !hasTowerSite && currentTowers + newTowersCount < maxTowers) {
                        const result = room.createConstructionSite(pos.x, pos.y, STRUCTURE_TOWER);
                        if (result === OK) {
                            sitesPlaced++;
                            newTowersCount++;
                        }
                    }
                    
                    // Keep this position in the plan if tower doesn't exist yet
                    if (!hasTower) {
                        newTowerPositions.push(pos);
                    } else {
                        room.memory.construction.towers.count = (room.memory.construction.towers.count || 0) + 1;
                    }
                }
                
                // Update tower positions in memory
                room.memory.construction.towers.positions = newTowerPositions;
            }
        }
        
        // Create storage construction site if we have capacity
        if (room.controller.level >= 4 && room.memory.construction && 
            room.memory.construction.storage && 
            room.memory.construction.storage.planned && 
            room.memory.construction.storage.position && 
            sitesPlaced < sitesToPlace) {
            
            const pos = room.memory.construction.storage.position;
            
            // Check if there's already a storage or construction site here
            const storageKey = `${pos.x},${pos.y},${STRUCTURE_STORAGE}`;
            const hasStorage = structureMap.has(storageKey);
            const hasStorageSite = siteMap.has(storageKey);
            
            // Create storage construction site if needed
            if (!hasStorage && !hasStorageSite && !room.storage) {
                const result = room.createConstructionSite(pos.x, pos.y, STRUCTURE_STORAGE);
                if (result === OK) {
                    sitesPlaced++;
                }
            }
        }
        
        // Update room memory with current construction site count and IDs
        const updatedSites = room.find(FIND_CONSTRUCTION_SITES);
        room.memory.constructionSites = updatedSites.length;
        room.memory.constructionSiteIds = updatedSites.map(site => site.id);
        
        // Log if we created new sites
        if (sitesPlaced > 0) {
            console.log(`Created ${sitesPlaced} new construction sites in room ${room.name}, total now: ${updatedSites.length}`);
        }
        
        // If we still don't have enough sites, run again next tick
        if (updatedSites.length < TARGET_SITES_PER_ROOM) {
            // Force more frequent checks until we reach our target
            room.memory.construction.lastUpdate = Game.time - 95; // Will trigger again in 5 ticks
        }
    }
};

// Wrap the module with error handling
const constructionManager = utils.wrapModule(constructionManagerImpl, 'constructionManager');

// Add debugging helper
constructionManager.debugLastError = function() {
    if (global.errors && global.errors.length > 0) {
        const lastError = global.errors[global.errors.length - 1];
        console.log(`Last error at tick ${lastError.time}:`);
        console.log(`${lastError.module}.${lastError.method}: ${lastError.message}`);
        console.log(`Stack: ${lastError.stack}`);
        return lastError;
    }
    return 'No errors recorded';
};

// Check for missing methods that might be referenced
const requiredMethods = [
    'run', 'updateConstructionSiteCount', 'checkRoomEvolution', 
    'planRoads', 'planContainers', 'planExtensions', 'planTowers', 'planStorage',
    'findTowerPosition', 'findControllerContainerPosition', 'createConstructionSites'
];

for (const method of requiredMethods) {
    if (typeof constructionManagerImpl[method] !== 'function') {
        console.log(`WARNING: constructionManager is missing method: ${method}`);
    }
}

module.exports = constructionManager;