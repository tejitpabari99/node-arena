# Audio

`createAudio` consumes v2 manifest event/visual sounds with voice limits, cooldowns, separate music/SFX gains and gesture-gated playback. `connectAppAudio` observes controller audio preferences, match identity and public sim events. Picker/HUD mute writes go through the save store. Unloading or restarting a level releases its buffers; disposal releases listeners and owned contexts.
