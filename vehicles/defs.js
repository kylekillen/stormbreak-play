// Vehicle type definitions: physics + handling + presentation tuning.
// Model space: +Z forward, +Y up, +X left. Dimensions in metres, mass in kg.
export const PAINTS = [0xb3121f, 0x1d4e89, 0xe8e4da, 0x111214, 0x6b7076, 0xd8a31a, 0x2f6b3a, 0xc4561c,
  0x5a1d6e, 0x8fb4c9, 0x7a2c22, 0x24343f, 0xcfc8b4, 0x0f6f73];
export const REGIME = { olive: 0x4a5236, stripe: 0xa3161a };

const car = (o) => ({ kind: 'car', seats: 1, camDistance: 7, camHeight: 2.4, nitro: true, ...o });

export const DEFS = {
  sports: car({ label: 'Sports car', size: [1.95, 1.15, 4.4], mass: 1250, com: -0.35, wheelR: 0.34, wheelW: 0.28,
    wheelX: 0.82, wheelZ: [1.38, -1.32], wheelY: -0.22, rest: 0.32, stiff: 38, damp: 4.4, grip: 2.6, engine: 9200, top: 72,
    brake: 40, steer: 0.55, health: 320, civilian: true, camDistance: 6.5, camHeight: 2.1 }),
  sedan: car({ label: 'Sedan', size: [1.85, 1.45, 4.6], mass: 1400, com: -0.4, wheelR: 0.34, wheelW: 0.24,
    wheelX: 0.8, wheelZ: [1.42, -1.38], wheelY: -0.3, rest: 0.4, stiff: 28, damp: 3.6, grip: 2.2, engine: 6200, top: 52,
    brake: 34, steer: 0.6, health: 360, civilian: true }),
  pickup: car({ label: 'Pickup', size: [2.0, 1.8, 5.2], mass: 1900, com: -0.45, wheelR: 0.42, wheelW: 0.3,
    wheelX: 0.86, wheelZ: [1.62, -1.55], wheelY: -0.42, rest: 0.5, stiff: 26, damp: 3.2, grip: 2.3, engine: 8400, top: 48,
    brake: 40, steer: 0.58, health: 460, civilian: true, chunky: true, camDistance: 8 }),
  jeep: car({ label: 'Military jeep', size: [1.9, 1.7, 4.2], mass: 1700, com: -0.45, wheelR: 0.42, wheelW: 0.32,
    wheelX: 0.82, wheelZ: [1.32, -1.28], wheelY: -0.4, rest: 0.5, stiff: 30, damp: 3.4, grip: 2.5, engine: 8600, top: 50,
    brake: 42, steer: 0.6, health: 520, regime: true, chunky: true, weapon: 'mg', camDistance: 7.5, camHeight: 2.8 }),
  truck: car({ label: 'Armored truck', size: [2.5, 2.9, 7.2], mass: 7500, com: -0.7, wheelR: 0.58, wheelW: 0.42,
    wheelX: 1.05, wheelZ: [2.4, -1.5, -2.7], wheelY: -0.8, rest: 0.55, stiff: 32, damp: 4.2, grip: 2.2, engine: 26000,
    top: 34, brake: 120, steer: 0.5, health: 1400, regime: true, chunky: true, nitro: false, camDistance: 12, camHeight: 4 }),
  tank: { kind: 'tank', label: 'Battle tank', size: [3.4, 1.5, 7.0], mass: 30000, com: -0.6, wheelR: 0.45, wheelW: 0.6,
    wheelX: 1.35, wheelZ: [2.4, 0.8, -0.8, -2.4], wheelY: -0.5, rest: 0.45, stiff: 40, damp: 5, grip: 3, engine: 90000,
    top: 18, brake: 600, health: 3000, regime: true, weapon: 'cannon', camDistance: 13, camHeight: 5 },
  heli: { kind: 'heli', label: 'Helicopter', size: [1.9, 2.2, 5.0], mass: 1600, health: 420, civilian: true,
    rotorR: 5.2, maxSpeed: 58, camDistance: 14, camHeight: 4 },
  attackHeli: { kind: 'heli', label: 'Attack helicopter', size: [1.4, 2.3, 6.0], mass: 2400, health: 900, regime: true,
    rotorR: 6.0, maxSpeed: 70, weapon: 'heli', camDistance: 16, camHeight: 4.5 },
  plane: { kind: 'plane', label: 'Prop plane', size: [1.4, 1.5, 7.4], mass: 1100, health: 380, civilian: true, span: 10.5,
    thrust: 9000, vTakeoff: 30, vStall: 22, maxSpeed: 85, wheelR: 0.3, camDistance: 16, camHeight: 4 },
  jet: { kind: 'plane', label: 'Fighter jet', size: [2.2, 2.0, 14.5], mass: 9000, health: 800, regime: true, span: 9.5,
    thrust: 160000, vTakeoff: 60, vStall: 45, maxSpeed: 290, wheelR: 0.42, weapon: 'jet', afterburner: true,
    camDistance: 24, camHeight: 5 },
  boat: { kind: 'boat', label: 'Speedboat', size: [2.4, 1.2, 7.0], mass: 1500, health: 420, civilian: true,
    thrust: 14000, maxSpeed: 34, turn: 1.3, camDistance: 11, camHeight: 3.5 },
  jetski: { kind: 'boat', label: 'Jet ski', size: [1.1, 0.8, 3.0], mass: 380, health: 160, civilian: true,
    thrust: 5200, maxSpeed: 28, turn: 2.2, camDistance: 6.5, camHeight: 2.4 },
};
// Aliases so 'car' (contract) and other common names spawn something sensible.
export const ALIASES = { car: 'sedan', apc: 'truck', helicopter: 'heli', speedboat: 'boat', airplane: 'plane', fighter: 'jet' };
export const resolveType = t => DEFS[t] ? t : (ALIASES[t] && DEFS[ALIASES[t]] ? ALIASES[t] : 'sedan');
