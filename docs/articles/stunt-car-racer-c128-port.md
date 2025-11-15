<style>
  footer {
    display: none;
  }
  img {
    display: block;
    margin: auto;
  }
</style>

# Porting Stunt Car Racer to the Commodore 128

A few days ago I released the [C128 port of Stunt Car Racer](https://csdb.dk/release/?id=257046). The release is in the form of a boot disk, so just insert it and reboot your computer or emulator -- both [VICE](https://vice-emu.sourceforge.io/) and [Z64K](https://www.z64k.com/) should be able to handle it without trouble. The game is essentially the same as the C64 original, just about 50% faster on PAL and 40% faster on NTSC machines. Here's a little demonstration of the speed gains using the same replay on both versions:

{% include youtube.html id="C7kgYlKhTgo" %}

## Background

The [Commodore 128](https://en.wikipedia.org/wiki/Commodore_128) was the last 8-bit computer that came out of the legendary company. It shared the video and sound hardware of the C64 while adding some new capabilities, including the obvious extra 64K of RAM. However, it was not really a seamless extension of the old platform, because it couldn't run C64 programs natively due to some differences. Instead, it could be switched into a mode where it would effectively behave like a genuine C64 to provide a sort of backwards compatibility.

The new features were quite useful for business and educational software that were often written in BASIC, but the gains were less obvious for games. In practice, most games would only target the C64, since that allowed them to run fine on both machines, and as a result there are really only a handful of games with native C128 versions.

I was intrigued by the idea of adding a new member to this very short list, and I was also wondering how much extra performance we could get by using the native features of the C128. Since I already created three different ports of Stunt Car Racer ([SuperCPU](https://www.youtube.com/watch?v=xaCca4zCimc), [Plus/4](https://www.youtube.com/watch?v=3ZE2UL2FWKE) and [Apple II](https://www.youtube.com/watch?v=N2uZCSfIqR4)), I figured pulling the same trick   the fourth time would be the shortest road to the kind of glory I was seeking.

## Extra Power

As the name suggests, the C128 comes with 128K of RAM, and it was designed to easily handle 256K or even more as a future extension. Since an 8-bit CPU cannot address more than 64K memory directly, the C128 added a Memory Management Unit (MMU) that gave developers a lot of control over the memory layout compared to the rigid hardwired logic of the C64. Here are some of the more important features:

- switch the active RAM blocks (i.e. 64K pages) independently for the CPU and the VIC
- designate certain address ranges as shared RAM, which always come from the default block
- relocate the zero page and the stack to anywhere in memory

On top of these, there's extra freedom given to the VIC chip:

- there are two colour RAMs that can be switched between instantly (again separately for the CPU and the VIC)
- the character ROM is not hardwired any more, it can be switched on at will regardless of which VIC bank is selected
- the CPU can be switched to operate at 2 MHz as long as the VIC is not actively displaying anything

Besides these, the C128 adds quite a few more new features (including a whole other video chip and CPU) that are not relevant to this project.

## Memory Layout

Stunt Car Racer does push the C64 to its limits, including the memory. Just like most programs on the platform, it starts at $0801. However, it fills up the RAM until the very last byte, address $ffff. Of course it also uses the first $800 bytes of the memory -- including most of the stack -- for state variables. There are a few small gaps left here and there, but the game is so starved for memory that it has to shuffle around the video data whenever it switches between the menu and gameplay.

The VIC bank is always set to $4000-$7fff, and the second half contains the full bitmap seen during gameplay with the car's inside view. The first half plays two roles:

- in the menu it is the active bitmap
- during gameplay it hosts all sprites, the bitmap colours and the second viewport for double buffering

Where do all these assets go when showing the menu? Well, this is what the second bitmap looks like outside gameplay:

![Stunt Car Racer gameplay bitmap when the menu is active](/assets/stunt-car-racer-c128-port/gameplay-bitmap-under-menu.png)

The viewport area inside the second bitmap is used to temporarily back up the sprites and the colour data. For those not familiar with the C64, the sprites are not recognisable here because their layout is different from that of bitmap screens (unlike, say, the NES, where everything is made of 8×8 tiles). As for the menu image during gameplay, it's partly stored under the I/O area ($d000-$dfff) along with some other data, and partly procedurally generated.

### More Is Less, Sometimes

The C128 has more memory than the C64, so one would naively think that fitting the existing program into RAM would be a non-issue. However, due to all the extra features provided by the OS, the system reserves a bigger chunk of memory to itself, and programs are loaded from $1c01 onwards. This wouldn't necessarily be a problem if it wasn't for the fact that Stunt Car Racer has save game functionality. Without it, we could just take over the computer for good and forget about the OS. However, unless we want to implement our own disk routines, we need to hand back the reins to the system once in a while. As a consequence, we cannot rely on the area below $1c00 to store any persistent data.

My solution to this problem was to relocate the video memory to the $0000-$3fff range. Conveniently, the first bitmap ($0000-$1fff) covers the whole system area, and it is exactly the one whose contents can be freely overwritten, since the game needs to restore it both for the menu and the in-game view anyway.

On the C64, this area couldn't be used as a bitmap in general, since the first $200 bytes are taken up by the zero page and the stack. This is where the MMU's ability to relocate these special pages comes to our help. In the case of Stunt Car Racer, I chose to move the zero page and stack to $e000 and $e100, respectively -- right after the I/O area. What we refer to as "relocation" is actually a swap: with these settings, memory accesses addressed to $02-$1ff go to the RAM at $e002-$e1ff (addresses $00 and $01 are still special on the C128, but with different functionality compared to the C64), and memory accesses addressed to $e000-$e1ff are mapped to the physical addresses $00-$1ff.

Note that relocation is not just an address translation mechanism. If we relocate the zero page to the I/O area, e.g. page $d0 where the VIC registers live, it still targets the underlying RAM regardless of whether I/O is mapped in at the moment. Sadly, we cannot write I/O registers at a speed of 3 cycles per byte, even though that would be a really powerful upgrade making new visual effects possible.

### Startup Juggling

After some consideration, I came up with the following startup process:

1. The game is an ordinary executable prg that's loaded at $1c01 either manually or through the auto-boot feature of the OS (the game starts automatically if you insert the disk before booting the computer).
2. When run, the program unpacks the title image into the second RAM block starting from $c000 and tells the VIC to show it.
3. Then it unpacks the actual game to the first RAM block between $500 and $feff (the highest address available, as $ff00-$ff04 are hardcoded MMU registers).
4. The initialisation routine starts executing at $500, and it sets up the middle of the second RAM block (the $4000-$bfff area) with all the data that couldn't fit in the first.
5. Finally, we show the menu, wiping out the init code under $2000, and the game proper can start.

During development, I could just inject the unpacked game directly into RAM and jump to the init code, so the startup is practically instantaneous. In order to make this process as quick as possible, I set up the injection to happen without waiting for the system to boot. When a C128 is turned on, its Z80 CPU takes control at first, then hands it over to the 6502 (really an 8502, but it's the same thing from the programmer's perspective). The first address executed by the 6502 is $1100. The VICE emulator can be started with a command line option that sets an initial breakpoint, so I invoke it with the following command:

```
x128 -initbreak 0x1100 -moncommands startup.vs
```

This causes the emulator to stop exactly when the 6502 would execute its first instruction, and run a series of monitor commands specified in the `startup.vs` file which has the following contents:

```
> ff00 3f
pb "bin/scr.vs"
load "bin/scr.prg" 0
r fl=0, pc=500
del 1
```

First we store $3f to $ff00, which is the MMU register defining the memory map. In this case the whole 64K range gets mapped to RAM. Then the `pb` (`playback`) command is used to load the symbols, which are given in a monitor script generated by the assembler. Then we `load` the prg file itself (the 0 means that it comes from the host filesystem), which specifies its own load address. This step doesn't emulate an actual loading process, just stores the program directly in RAM. Finally, we reset the flags register and set the program counter to $500, effectively jumping to the initialisation code. The `del` command is used to remove the now unnecessary breakpoint.

Since this process prevents any of the system code from running, the game has to make sure to fully set up the hardware registers during initialisation. This is useful, because it won't make any assumptions about its executing environment, and works fine no matter whether it's injected directly or loaded from a disk.

### Spilling Over

After leaving the title screen, the game operates with a configuration where the first and last 16K of RAM is always set as shared, i.e. we see RAM from the first block in those areas at all times. As mentioned before, the lowest 16K is used as the VIC bank, while the highest 16K starting at $c000 is used for all game state plus any code that needs to perform bank switching or otherwise needs to be always available, like the interrupt handler.

The second block is used to host the following data:

- uncompressed arctangent table (this bit alone takes up 8K!)
- menu screen backup (9K including the colour data)
- exponential table
- dashboard image
- almost all the menu strings (over 1K)
- unrolled screen clear code

There's still plenty of space to spare. That's of course expected, since the original game fits in 64K, and I added only a few kilobytes of data for optimisation purposes. Altogether, the C128 version uses about 85K of memory excluding the title image (another 10K on top).

## Performance

Each frame update consists of three major steps: advancing the simulation, clearing the viewport and rendering the frame. Having more space for code allowed me to implement a few optimisations that improve each of these components. I profiled the code and focused my attention on the lowest-hanging fruits.

In order to measure the improvements, I used an identical replay (the one shown on the demonstration video above) on all versions, where the player completes a whole lap on the Little Ramp behind the opponent, which is a worst-case scenario for overall performance. During the evaluation, I'm comparing clock cycles for each feature and not counting the speedup from the higher clock rate available on the C128.

It must be noted that all the figures below are wall clock times, i.e. they include other processes like interrupts and DMA (the VIC chip needs to steal about 1.5K cycles per physical frame to display the bitmap and the sprites). The comparisons are still largely valid even with this caveat, and this means that the percentage figures mentioned below actually underestimate the real gains if we were to look at the own time of each update step.

### Player Simulation

The simulation phase advances the state of the player. This is where all the suspension physics is handled, and the easiest way to speed up this part was to replace the multiplication routine with a faster one. The original uses a simple unrolled loop, which I replaced with a more memory-hungry [table-based method](http://www.6502.org/source/integers/fastmult.htm). After all the changes, the average runtime of this step was 89.7% of the original when measured in clock cycles.

![Stunt Car Racer time comparison](/assets/stunt-car-racer-c128-port/simulation-cycles.svg)

The first 130 frames or so are spent on the crane as the car is lifted up before the race starts. Afterwards, there are clear peaks whenever the car is in a corner. This is caused by the fact that mapping between world and road local coordinates is a lot more computationally heavy in corners compared to straight sections.

### Viewport Clearing

In the original, the viewport is cleared quite efficiently, using 5 clock cycles per byte plus a bit of overhead. There are 13 rows (8 pixels high), each spanning 256 bytes, that need to be filled with $ff during this phase. I managed to improve this process in two ways:

- I skip clearing the top rows that were not touched during rendering the current frame: the ones that are fully covered by the sky.
- Using the MMU allowed me to clear the rest of the viewport at 3 clock cycles per byte.

There are two alternative approaches one can take with the MMU: relocate either the zero page or the stack for fast access. Neither is strictly better than the other in every situation; below I marked the better option in bold:

| Criterion | Zero Page | Stack |
| :---: | :---: | :---: |
| Code Size | 2 bytes per store (`sta zp`) | **1 byte per store** (`pha`) |
| Speed | 3 cycles per store | 3 cycles per store |
| Coverage | Cannot use the first 2 bytes | **All bytes are accessible** |
| Interrupts | **Doesn't interfere** | Some bytes under the stack pointer can be clobbered |

Using the zero page is straightforward, but it cannot cover the first two bytes as addresses $00 and $01 are wired to the processor port on both the C64 and the C128:

```
lda #$ff
sta $02
sta $03
sta $04
...
sta $ff
```

As for the stack, we can just push the desired value repeatedly after relocation:

```
ldx LastOffset
txs
lda #$ff
pha
pha
pha
...
```

If we can disable interrupts, this is clearly a better solution, since the code is both smaller and can cover every byte in a page. However, Stunt Car Racer triggers several raster interrupts during gameplay to switch bitmaps, reconfigure sprites or toggle the higher clock speed. None of these have very strict deadlines, but we cannot disable interrupts for extended periods, otherwise we'd get visual glitches.

Still, I went with the stack-based approach, as it's much easier to deal with overall. Another complication to grapple with is the fact that while each row of the viewport takes up 256 bytes, none of them are aligned with page boundaries. We need to fill each of them in two batches:

| Row | Address Range 1 | Address Range 2 |
| :---: | :---: | :---: |
| 0 | $02a0--$02ff | $0300--$039f |
| 1 | $03e0--$03ff | $0400--$04df |
| 2 | $0520--$05ff | $0600--$061f |
| 3 | $0660--$06ff | $0700--$075f |
| 4 | $07a0--$07ff | $0800--$089f |
| 5 | $08e0--$08ff | $0900--$09df |
| 6 | $0a20--$0aff | $0b00--$0b1f |
| 7 | $0b60--$0bff | $0c00--$0c5f |
| 8 | $0ca0--$0cff | $0d00--$0d9f |
| 9 | $0de0--$0dff | $0e00--$0edf |
| 10| $0f20--$0fff | $1000--$101f |
| 11| $1060--$10ff | $1100--$115f |
| 12| $11a0--$11ff | $1200--$129f |

The clearing process starts from the bottom and stops whenever we reach the first row fully covered by the sky. The raster interrupt routine requires 7 bytes of stack, so my solution to the problem is simple: I disable interrupts before filling the last 8 bytes of each batch. If an interrupt is triggered in the middle of the batch, that's not an issue, since as soon as we return from it, the subsequent `pha` instructions will overwrite whatever it left on the stack. At the end of each batch I change the page to the next one (the stack pointer is automatically correct, since it just rolled over) and reenable interrupts.

After these two improvements, the average time to clear the viewport ended up being 63.3% of the original during the replay:

![Stunt Car Racer time comparison](/assets/stunt-car-racer-c128-port/clear-cycles.svg)

It's easy to see which parts of the replay had more sky visible, since the processing time falls quite dramatically. But even the worst case is much better than the original thanks to cutting the time to 3 cycles per byte.

During the crane phase the whole viewport needs to be cleared every time because the chains reach the top of the frame. The moment the car is dropped and the chains disappear, the top half of the view starts out as clear sky, so we don't have to touch it for a while. Just like in the simulation phase, the corners are slower, as the car is angled in such a way that the track fills the view to the top. There are also additional peaks between the corners: when the car lands after a jump, we don't see the sky, therefore we need to do full clears until the car is righted again.

Note that the optimisation does not affect the whole clearing routine. Part of it is also redrawing the front of the car, which adds a few thousand cycles. I could have unrolled that part too, but laziness prevailed at that point, and it likely wouldn't make a noticeable difference.

### Frame Rendering

By far the biggest portion of time is spent rendering the road: projecting vertices from the 3D world space to the screen and drawing lines while managing coverage. This part is very well optimised already, but there were still two ways I could speed it up.

Each vertex is projected by calculating the horizontal and vertical angles between the forward vector and the vector pointing to the vertex from the camera. This requires an arctangent table, which the C64 version has to store in a compressed form in just 1K. For the C128, I unpacked the table for faster query, which requires 8K of memory. This gives us a tiny boost both in rendering and during simulation (some angles need to be computed in the corners).

I also found a surprising easy win that could be applied to the original as well. When the car is in a corner, it's actually possible to reduce the view distance without affecting the final result. This was just a few additional instructions, and the effect is quite visible on the graph below, where the peaks corresponding to corners (but not the jumps) are shaved off on the C128. This also nicely compensates the more intense processing needed in other areas at the same time.

All in all, average rendering time ended up at about 96.5% of the original.

![Stunt Car Racer time comparison](/assets/stunt-car-racer-c128-port/render-cycles.svg)

The last bit where processing time plummets is where we pass the opponent just before crossing the finish line. It shows clearly how much faster the game is when the opponent is not visible, which is really what happens most of the time.

### Overall Comparison

Finding optimisations is nice, but in the end the biggest boost comes from the ability to boost the CPU to run at double speed in the top and bottom border areas. On PAL machines we have 312 raster lines, and 112 of them allow running at 2 MHz (unless we want to display sprites in the border, but that's not the case here). This gives us a roughly 36% speed boost. Coupled with the gains from all the above discussed improvements, we land somewhere at 50% speedup compared to the C64 original:

![Stunt Car Racer time comparison](/assets/stunt-car-racer-c128-port/frame-times.svg)

The series labeled "C128 slow" shows the performance of the optimised code without the clock rate boost. On average we save about one physical frame (roughly 20K cycles on PAL machines) during each game update.

One could say that the results without the clock rate boost are underwhelming, but I'd disagree with that assessment. We have to remember that Geoff Crammond spent three years developing this game and clearly a lot of that time went into squeezing out as much performance of the C64 as humanly possible. It's a testament to his skills that he left so little on the table even with the strict memory limitations he had to work within. It would be possible to shave off a few more cycles here and there, but I really did focus on the easiest wins, and I doubt that there's much to gain beyond this point.

## Final Thoughts

Before tackling this challenge, I didn't know much about the C128, and this was a fun way to get familiar with the platform. I was also positively surprised how much attention this port got; I wasn't expecting more than a handful of people to be truly interested. While the C128 is not really talked about much, it's also a fact that it sold millions, so there are quite a few of them floating around to this day. Besides, there's only a very short list of games -- and none of them exclusive -- that run in native C128 mode and actually take advantage of the new features, so in hindsight it makes sense that there's an eager audience for more.

The story doesn't necessarily end here. The extra space unlocks quite a few optimisation opportunities, and some of those could be easily brought back to the C64. Reducing draw distance in the corners is a tiny yet powerful change, and I think even the logic to skip the unchanged sky rows could also be implemented within the 64K limits. However, if we were to adapt the game to a cartridge format, we could get all the other improvements as well. Maybe someday!