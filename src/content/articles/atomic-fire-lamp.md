---
title: "Building the Atomic Fire Lamp"
description: "An ESP32 running WLED drives a WS2812B strip inside a pendant fixture for a convincing flame effect. A weekend build inspired by Dave's Garage."
date: 2026-06-16
keywords: "Atomic Fire Lamp, WLED, ESP32, WS2812B, addressable LED, Dave's Garage, DIY lamp, fire effect, FastLED"
ogTitle: "Building the Atomic Fire Lamp"
ogDescription: "ESP32 + WLED + a WS2812B strip in a pendant light: a convincing flame effect, start to finish."
badges: ["Hardware", "DIY", "ESP32", "WLED"]
related: []
draft: false
---

<div style="background: var(--bg-surface); padding: 1rem; border: 1px solid var(--border-accent); border-left: 3px solid var(--accent-primary); margin: 0 0 1.5rem;">
  <p style="margin: 0; font-size: 0.9rem;"><strong>Heads-up:</strong> the parts list below uses affiliate links. Buying through them helps fund <a href="/openworld">OpenWorld</a> and the homelab, at no extra cost to you. See the <a href="/disclosure">disclosure</a>.</p>
</div>

Dave Plummer (of [Dave's Garage](https://youtu.be/_wCOCI18nAk)) built a lamp that looks like it has a contained, living flame inside it. No fire, no moving parts, just a strip of addressable LEDs running a fire animation behind a diffuser. I watched the assembly video, decided I needed one on the shelf, and ordered the parts that night. Here's the whole build.

## What It Actually Is

Strip the romance away and it's three things: a lamp body to diffuse the light, a length of individually-addressable LEDs, and a microcontroller running a fire animation. The diffuser is what sells it, it blurs the individual LEDs into a single warm, flickering glow that reads as flame from across the room.

I used a cheap pendant fixture as the body, a WS2812B strip for the LEDs, and an ESP32 running [WLED](https://kno.wled.ge/) for the brains. WLED is the shortcut here: it ships with a **Fire 2012** effect out of the box, so there's no code to write.

## The Parts

- <a href="/go/elinkume-pendant/" rel="sponsored noopener noreferrer" target="_blank">ELINKUME 23W LED pendant light</a> — the body. Gut the original LED guts; you're keeping the shade and the diffuser tube.
- <a href="/go/btf-ws2812b/" rel="sponsored noopener noreferrer" target="_blank">BTF-LIGHTING WS2812B strip</a> — 144 LEDs/m, individually addressable. The high density matters: more LEDs per inch means a smoother flame and no visible "dots" through the diffuser.
- <a href="/go/esp32-devboard/" rel="sponsored noopener noreferrer" target="_blank">ESP32 (ESP-WROOM-32) dev board</a> — runs WLED, joins Wi-Fi, costs a few dollars.
- <a href="/go/naoevo-16awg-wire/" rel="sponsored noopener noreferrer" target="_blank">NAOEVO 16 AWG stranded wire</a> — for the 5V power run. Thin signal wire sags voltage over any real length; use proper gauge for power.
- A **5V power supply** sized to your LED count (see the power note below). The strip does *not* run off the ESP32's regulator.

## How It Works

Every WS2812B LED has its own little driver chip baked in, so a single data line can address all 144 of them independently, color and brightness, pixel by pixel. WLED takes that data line and renders animations on it. Its **Fire 2012** effect (a port of the classic FastLED algorithm) walks a heat value up the strip and maps it onto a warm palette, so the "flame" rises, flickers, and dies down exactly like the real thing. You tune intensity and speed from your phone and never touch a line of code.

## The Build

1. **Gut the fixture.** Pull the original LED board out of the ELINKUME pendant. Keep the housing, the shade, and especially the frosted diffuser, that's the part doing the optical work.
2. **Mount the strip.** Wind or run the WS2812B inside the body so the diffuser sits between the LEDs and your eye. Watch the little arrows printed on the strip, they show data direction, and the data input (DIN) has to be the upstream end.
3. **Wire it.** Run 5V and GND from the supply to the strip with the 16 AWG wire. Run the data line from an ESP32 GPIO (GPIO2 is a sane default) to the strip's DIN.
4. **Tie the grounds together.** The ESP32 ground and the power-supply ground *must* be common, or the data signal has no reference and nothing lights correctly. This is the single most common mistake.
5. **Inject power at both ends.** On a 1m+ run of 144/m, feed 5V to both ends of the strip so the far end doesn't brown out and shift color.

## Flashing WLED

The easy path is the browser installer, no toolchain required:

```
1. Plug the ESP32 into your machine over USB.
2. Open https://install.wled.me in Chrome or Edge.
3. Click Install, pick the serial port, let it flash.
4. Join the WLED-AP Wi-Fi, point it at your network.
```

Then in the WLED UI: open **Config → LED Preferences**, set the LED count (144 per meter you used) and the data GPIO (2). Back on the main screen, pick the **Fire 2012** effect, choose a warm palette, dial in intensity and speed, and save it as a preset so it comes up that way on every power-on.

## Notes and Gotchas

- **Power budget.** 144 LEDs at full white is roughly 8.6 A at 5V. The fire effect never gets anywhere near that, but size the supply with headroom and never try to run the strip off the ESP32's 3.3V regulator, you'll brown out the board.
- **Logic levels.** WS2812B nominally wants ~5V on the data line. At short runs a 3.3V ESP32 pin usually drives it fine; if the first few LEDs flicker or show the wrong color, add a level shifter.
- **Diffusion is everything.** If you can see individual LEDs, add distance or a heavier diffuser. The magic is in *not* seeing the strip.

## The Result

Through the diffuser, the individual LEDs vanish and what's left is a warm flicker that genuinely reads as a contained flame. It's the kind of build that's cheap, takes an evening, and gets a "wait, is that real?" from everyone who walks past it.

<!-- TODO(michael): drop a photo or short GIF of the finished lamp here, e.g. /pix/atomic-fire-lamp.jpg -->

All credit to [Dave Plummer's Dave's Garage](https://youtu.be/_wCOCI18nAk) for the original Atomic Fire Lamp, watch his assembly video for the inspiration and a second take on the wiring.

Building one yourself, or want to compare notes? [Drop me a line](../contact).
