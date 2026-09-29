# CLAUDE.md - Sandlot

Browser baseball batting game. Vite + vanilla JS + three.js. All art and audio are generated in code.

*(This file is expanded at the end of the build with the full architecture guide.)*

## Commands
- `npm run dev` - dev server
- `npm test` - Vitest unit tests (pure game logic in `src/game`, `src/physics`)
- `npm run build` - production build into `dist/`

## Conventions
- All tunable numbers live in `src/config.js`.
- Coordinates: feet; origin = back tip of home plate; +x = right field side; -z = toward center field; +y up.
