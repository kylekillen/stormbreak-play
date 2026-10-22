# Asset credits

Everything downloaded for this game is **CC0 (public domain)**. Textures and sky are from
[Poly Haven](https://polyhaven.com) — licence: https://polyhaven.com/license
(CC0 1.0, no attribution required; credited here anyway). Nothing was taken
from any other game. Downloaded 2026-10-13 via the public Poly Haven API
(`https://api.polyhaven.com/files/<id>`), 1k JPG maps (colour `_diff`,
OpenGL normal `_nor`, AO/roughness/metal `_arm`).

| File(s) in `assets/` | Poly Haven asset | Page | Authors | Licence |
|---|---|---|---|---|
| `hdri/sky_2k.hdr` | kloofendal_48d_partly_cloudy_puresky (2k HDR) | https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky | Greg Zaal, Jarod Guest | CC0 |
| `hdri/clear_2k.hdr` (the midday sky) | kloofendal_43d_clear_puresky (2k HDR) | https://polyhaven.com/a/kloofendal_43d_clear_puresky | Greg Zaal | CC0 |
| `hdri/afternoon_2k.hdr` (the default afternoon sky) | qwantani_afternoon_puresky (2k HDR) | https://polyhaven.com/a/qwantani_afternoon_puresky | Greg Zaal, Jarod Guest | CC0 |
| `hdri/golden_2k.hdr` | qwantani_late_afternoon_puresky (2k HDR) | https://polyhaven.com/a/qwantani_late_afternoon_puresky | Greg Zaal, Jarod Guest | CC0 |
| `tex/grass_*` | aerial_grass_rock | https://polyhaven.com/a/aerial_grass_rock | Rob Tuytel | CC0 |
| `tex/concrete_*` | concrete_floor_worn_001 | https://polyhaven.com/a/concrete_floor_worn_001 | Dimitrios Savva, Rico Cilliers | CC0 |
| `tex/stone_*` | marble_01 | https://polyhaven.com/a/marble_01 | Rob Tuytel | CC0 |
| `tex/brick_*` | red_brick_03 | https://polyhaven.com/a/red_brick_03 | Rob Tuytel | CC0 |
| `tex/asphalt_*` | asphalt_02 | https://polyhaven.com/a/asphalt_02 | Rob Tuytel | CC0 |
| `tex/plywood_*` | plywood | https://polyhaven.com/a/plywood | Rob Tuytel | CC0 |
| `tex/metal_*` | metal_plate | https://polyhaven.com/a/metal_plate | Rob Tuytel | CC0 |
| `tex/bark_*` | bark_brown_02 | https://polyhaven.com/a/bark_brown_02 | Rob Tuytel | CC0 |
| `tex/wall_*` | concrete_wall_008 | https://polyhaven.com/a/concrete_wall_008 | Charlotte Baglioni, Dario Barresi | CC0 |
| `tex/plaster_*` | painted_plaster_wall | https://polyhaven.com/a/painted_plaster_wall | Amal Kumar | CC0 |
| `tex/paving_*` | concrete_pavement | https://polyhaven.com/a/concrete_pavement | Charlotte Baglioni | CC0 |
| `tex/jersey_*` | cotton_jersey | https://polyhaven.com/a/cotton_jersey | colormass, Rico Cilliers | CC0 |
| `tex/denim_*` | denim_fabric | https://polyhaven.com/a/denim_fabric | Rob Tuytel | CC0 |
| `tex/planks_*` | wood_planks | https://polyhaven.com/a/wood_planks | Amal Kumar | CC0 |

## Building facades (`tex/fac_*`) — ambientCG

All **CC0 1.0** from [ambientCG](https://ambientcg.com) (licence: https://docs.ambientcg.com/license/), by Lennart Demes.
Downloaded 2026-10-14 as 1K-JPG; repacked (colour `_diff`, OpenGL normal `_nor`, AO/roughness/metal `_arm`, emission `_emi` at 512 px).
Used on the distant towers and the far skyline only.

| File(s) in `assets/tex/` | ambientCG asset | Page |
|---|---|---|
| `fac_glass_*` | Facade001 | https://ambientcg.com/view?id=Facade001 |
| `fac_teal_*` | Facade005 | https://ambientcg.com/view?id=Facade005 |
| `fac_ribbon_*` | Facade006 | https://ambientcg.com/view?id=Facade006 |
| `fac_grid_*` | Facade013 | https://ambientcg.com/view?id=Facade013 |
| `fac_office_*` | Facade015 | https://ambientcg.com/view?id=Facade015 |
| `fac_slab_*` | Facade017 | https://ambientcg.com/view?id=Facade017 |
| `fac_brick_*` | Facade018A | https://ambientcg.com/view?id=Facade018A |
| `fac_loft_*` | Facade019A | https://ambientcg.com/view?id=Facade019A |
| `fac_mill_*` | Facade020A | https://ambientcg.com/view?id=Facade020A |

Made in code: the near buildings' windows (rooms behind the glass are ray-cast in the shader), mural paint
flaking and rain streaks, and the weed tufts.

## The skater (`skater/skater.glb`)

A rigged human built 2026-10-14 in Blender 5.2 with MPFB 2.0.18 (the MakeHuman
add-on, https://extensions.blender.org/add-ons/mpfb/ — the add-on is GPL-3.0, its
output is not bound by that) from **CC0** MakeHuman assets, then baked to one
glTF with the "game_engine" skeleton. Build script: `tools/build_skater.py`.
Nothing in it is a likeness of a real person or a character from any game.

| Part | MakeHuman asset | Pack (download) | Author | Licence |
|---|---|---|---|---|
| Body, skin texture, eyes, eyebrows, eyelashes, hair (`short01`), shoes (`shoes05`), rig | makehuman system assets (`young_caucasian_male` skin, `low-poly` eyes, `eyebrow001`, `eyelashes01`) | https://files2.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip | Data Collection AB / MakeHuman team (released CC0 Sept 2020) | CC0 |
| Sweatshirt | `toigo_fisherman_sweater` (knit pattern removed in code; recoloured, loosened) | https://files2.makehumancommunity.org/asset_packs/shirts01/shirts01_cc0.zip | MargaretToigo (MRT) | CC0 |
| Pants | `cortu_cargo_pants` (subdivided, rebuilt by the build script into a baggy straight leg that stacks on the shoe) | https://files2.makehumancommunity.org/asset_packs/pants01/pants01_cc0.zip | Cortu Johnstone | CC0 |
| T-shirt (the `tee` outfit) | `toigo_basic_tucked_t-shirt` (untucked, loosened and lengthened by the build script; texture dropped, recoloured in code) | https://files2.makehumancommunity.org/asset_packs/shirts01/shirts01_cc0.zip | MargaretToigo (MRT) | CC0 |

Pack index and per-asset licences: https://static.makehumancommunity.org/assets/assetpacks.html
The beanie, the cap (worn forward or backward) and the hoodie's hood are original: the build script grows them from the model's own scalp and the sweatshirt's collar. The shoes keep the `shoes05` shape but are repainted entirely in code as a skate shoe (vulcanised sole, foxing stripe, suede toe cap, laces, wear); the chest prints are original artwork drawn in code with the game's own name.
The sweatshirt's fabric look uses the Poly Haven `cotton_jersey` maps above.

Made in code, not downloaded (original to this game): the eight wall murals (sunset waves, mountains, shapes, the word PUSH, daisies, rainbow arcs, checkers and lightning, diamonds — all drawn with canvas shapes in `park.js`), the painted floor shapes (ring, chevrons, hatching, starburst), the pigmented-concrete and painted-steel colours, the graffiti tags (invented words), chain-link fence, skid marks, puddles, plywood seams and screws, coping rust, trowel marks, the parked cars (four original body styles lofted in `public/cars.js`; no CC0 realistic car was found — Poly Haven has no vehicles, Quaternius/Kenney cars are toy-like, realistic ones on Sketchfab/CGTrader are paid or CC-BY/branded — so none were downloaded), floodlights and bleachers, the board,
the board graphic, grip tape, leaves, window sheet, stains, cracks, paint
wear, drain grates, pool tiles, painted-rail wear, every skatepark obstacle and the
park layout, and every shop/street sign. All sign names are invented.

## Sounds (`sfx/`)

All CC0 1.0 (public domain). Trimmed, loudness-matched and converted to mp3 with ffmpeg on
2026-10-14; nothing from any game.

| File(s) in `assets/sfx/` | Source | Author | Licence |
|---|---|---|---|
| `roll.mp3` (7 s of steady rolling, used as a granular loop) | freesound #398883 "skateboard_ride.wav" https://freesound.org/s/398883/ | PHetish | CC0 |
| `grind_metal.mp3` | freesound #348326 "Skateboard_Grinds.wav" https://freesound.org/s/348326/ | BlackNeon1234 | CC0 |
| `grind_concrete.mp3` | freesound #655372 "skateboard grinding on concreate slab.wav" https://freesound.org/s/655372/ | 21100495 | CC0 |
| `impactPlank_medium_*`, `impactWood_heavy_*`, `impactWood_light_*`, `impactMetal_medium_*`, `impactMetal_light_*`, `impactPlate_light_*`, `impactPunch_heavy_*`, `impactSoft_heavy_*`, `footstep_concrete_*` | Kenney "Impact Sounds" 1.0 https://kenney.nl/assets/impact-sounds | Kenney (www.kenney.nl) | CC0 |

Wheel surface colour, bearing hum, wind, scrubs, flip whooshes, traffic, birds and the room
reverb are made in code (`public/audio.js`).
