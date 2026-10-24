---
mode: testing
url: "http://localhost:4173/?kane=1&seed=1"
headless: true
tags: [kane, smoke]
max_steps: 8
---
# A → C button changes from ready to active

> From the seeded browser page, observe ready on the bottom-panel green A → C button, activate it once, and observe active on that same button.

## Step 1

Open http://localhost:4173/?kane=1&seed=1 and locate the bottom-panel green button whose text begins A → C, then assert its DOM text contains ready.

## Step 2

On that bottom-panel green A → C button, activate it once, then assert the same button's DOM text contains active.
