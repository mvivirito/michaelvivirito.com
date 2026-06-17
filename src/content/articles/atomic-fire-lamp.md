---
title: "Building the Atomic Fire Lamp"
description: "An ESP32 running WLED drives a WS2812B strip wrapped around a pendant frame into a glowing, atom-shaped lamp. A weekend build inspired by Dave's Garage."
date: 2026-06-16
keywords: "Atomic Fire Lamp, WLED, ESP32, WS2812B, addressable LED, Dave's Garage, DIY lamp, atom lamp, fire effect"
ogTitle: "Building the Atomic Fire Lamp"
ogDescription: "ESP32 + WLED + a WS2812B strip wrapped into an atom-shaped lamp: a convincing flame effect and the full color range."
ogImage: "/pix/atomic-fire-lamp-1.jpg"
badges: ["Hardware", "DIY", "ESP32", "WLED"]
related: []
draft: false
---

<div style="background: var(--bg-surface); padding: 1rem; border: 1px solid var(--border-accent); border-left: 3px solid var(--accent-primary); margin: 0 0 1.5rem;">
  <p style="margin: 0; font-size: 0.9rem;"><strong>Heads-up:</strong> the parts list below uses affiliate links. Buying through them helps fund <a href="/openworld">OpenWorld</a> and the homelab, at no extra cost to you. See the <a href="/disclosure">disclosure</a>.</p>
</div>

Dave Plummer (of [Dave's Garage](https://youtu.be/_wCOCI18nAk)) built a lamp shaped like an atom, glowing arcs of addressable LEDs crossing like electron orbits around a core. No screen, no actual fire, just a strip of WS2812B LEDs bent into a sphere and driven by an ESP32 running WLED. I watched the assembly video, decided I needed one on the bench, and ordered the parts that night. Here's the whole build.

<figure style="margin: 1.5rem 0;">
  <img src="/pix/atomic-fire-lamp-1.jpg" alt="The finished Atomic Fire Lamp: crossing arcs of LEDs glowing in a rainbow of colors in a dark room" width="1600" height="1200" loading="lazy" style="width: 100%; height: auto; border-radius: 8px;" />
  <figcaption class="text-muted" style="font-size: 0.85rem; text-align: center; margin-top: 0.5rem;">Running a rainbow cycle, every LED individually addressable.</figcaption>
</figure>

## What It Actually Is

Strip away the romance and it's three parts: a frame to hold the LEDs in a shape, a length of individually-addressable LEDs, and a microcontroller running an animation. The shape is what sells it, curved arcs crossing like the orbits in a Bohr-model atom, each one lined with WS2812B. WLED is the shortcut: it ships with a **Fire 2012** effect (the namesake) plus dozens of others, so the same lamp goes from a flickering flame to a full rainbow without writing a line of code.

## The Parts

- <a href="/go/elinkume-pendant/" rel="sponsored noopener noreferrer" target="_blank">ELINKUME 23W LED pendant light</a> — the skeleton. It's sold as a chandelier; I kept the curved arcs and the base, ditched the original driver, and used the arcs as the form to mount the strip along.
- <a href="/go/btf-ws2812b/" rel="sponsored noopener noreferrer" target="_blank">BTF-LIGHTING WS2812B strip</a> — 144 LEDs/m, individually addressable. The high density keeps the color gradients smooth as they sweep around each arc instead of reading as a string of dots.
- <a href="/go/esp32-devboard/" rel="sponsored noopener noreferrer" target="_blank">ESP32 (ESP-WROOM-32) dev board</a> — runs WLED, joins Wi-Fi, costs a few dollars.
- <a href="/go/naoevo-16awg-wire/" rel="sponsored noopener noreferrer" target="_blank">NAOEVO 16 AWG stranded wire</a> — for the 5V power run. Thin signal wire sags voltage over any real length; use proper gauge for power.
- A **5V power supply** sized to your LED count (see the power note below). The strip does *not* run off the ESP32's regulator.

## How It Works

Every WS2812B LED has its own little driver chip baked in, so a single data line can address all of them independently, color and brightness, pixel by pixel. WLED takes that data line and renders animations on it. Its **Fire 2012** effect (a port of the classic FastLED algorithm) walks a heat value along the strip and maps it onto a warm palette, so the "flame" rises and flickers, but the same firmware does rainbows, color sweeps, and solid colors too. You pick and tune all of it from your phone.

## The Build

1. **Strip the fixture to its frame.** Pull the original LED driver out of the ELINKUME pendant and keep the curved arcs and the base, that's your form.
2. **Run the strip along the arcs.** Lay the WS2812B down each arc, watching the little arrows printed on the strip, they show data direction, and the data has to flow continuously from one arc into the next.
3. **Wire it.** Run 5V and GND from the supply to the strip with the 16 AWG wire. Run the data line from an ESP32 GPIO (GPIO2 is a sane default) to the strip's data input.
4. **Tie the grounds together.** The ESP32 ground and the power-supply ground *must* be common, or the data signal has no reference and nothing lights correctly. This is the single most common mistake.
5. **Inject power at both ends.** Over a meter-plus of 144/m strip, feed 5V to both ends so the far arcs don't brown out and shift color.

## Flashing WLED

The easy path is the browser installer, no toolchain required:

```
1. Plug the ESP32 into your machine over USB.
2. Open https://install.wled.me in Chrome or Edge.
3. Click Install, pick the serial port, let it flash.
4. Join the WLED-AP Wi-Fi, point it at your network.
```

Then in the WLED UI: open **Config → LED Preferences**, set the LED count and the data GPIO (2). Back on the main screen, pick an effect, **Fire 2012** for the namesake, or a rainbow, and dial in intensity and speed. Save it as a preset so it comes up that way on every power-on.

## Notes and Gotchas

- **Power budget.** 144 LEDs at full white is roughly 8.6 A at 5V. Most effects never get near that, but size the supply with headroom and never try to run the strip off the ESP32's 3.3V regulator, you'll brown out the board.
- **Logic levels.** WS2812B nominally wants ~5V on the data line. At short runs a 3.3V ESP32 pin usually drives it fine; if the first few LEDs flicker or show the wrong color, add a level shifter.
- **Plan the seams.** Decide where the strip crosses from one arc to the next before you stick anything down, you want the data line continuous and the jumper wires hidden behind the frame.

## The Result

Powered up, it's exactly the toy you'd hope for: glowing arcs you can throw any color or animation at from your phone. Fire for ambiance, a slow rainbow for show, a solid color to match the room. It's cheap, it's an evening's work, and it earns a "wait, is that real?" from everyone who walks past it.

<div style="display: flex; gap: 1rem; flex-wrap: wrap; margin: 1.5rem 0;">
  <figure style="flex: 1 1 45%; margin: 0;">
    <img src="/pix/atomic-fire-lamp-2.jpg" alt="The Atomic Fire Lamp glowing in pink and magenta tones" width="1600" height="1200" loading="lazy" style="width: 100%; height: auto; border-radius: 8px;" />
  </figure>
  <figure style="flex: 1 1 45%; margin: 0;">
    <img src="/pix/atomic-fire-lamp-3.jpg" alt="The Atomic Fire Lamp glowing in cool blue tones" width="1600" height="1200" loading="lazy" style="width: 100%; height: auto; border-radius: 8px;" />
  </figure>
</div>
<p class="text-muted" style="font-size: 0.85rem; text-align: center; margin-top: -0.5rem;">Same lamp, two more of WLED's palettes, on the bench next to the printer.</p>

All credit to [Dave Plummer's Dave's Garage](https://youtu.be/_wCOCI18nAk) for the original Atomic Fire Lamp, watch his assembly video for the inspiration and a second take on the wiring.

Building one yourself, or want to compare notes? [Drop me a line](../contact).
