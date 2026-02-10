// -------------------------------------------------------------------
// ------------------- DDJ-FLX10 script file v.0.2 -------------------

PioneerDDJFLX10.syncHotcueLEDs = function () {
    var ports = [HcCH1Port, HcCH2Port, HcCH3Port, HcCH4Port];
    for (var d = 1; d <= 4; d++) {
        var port = ports[d - 1];
        for (var i = 1; i <= 8; i++) {
            var v = engine.getValue("[Channel" + d + "]", "hotcue_" + i + "_enabled");
            PioneerDDJFLX10.ColorTrigger(v, port, 0x00 + (i - 1), HC_Color, Black);
        }
    }
};
// -------------------------------------------------------------------

// *************************************************************************
// * Mixxx mapping script file for the Pioneer DDJ-FLX10.
// * Mostly adapted from the DDJ-1000 mapping script from Arnold Kalambani
// * Author: Marc Zischka (Zim)
// ****************************************************************************
//
//  Implemented (as per manufacturer's manual):
//      * Mixer Section (Faders, EQ, Filter, Gain, Cue)
//      * Browsing and loading 
//      * Jogwheels, Scratching, Bending, Loop adjust ?
//      * Cycle Tempo Range
//      * Beat Sync
//      * Hot Cue Mode
//      * Beat Loop Mode
//      * Beat Jump Mode
//      * Sampler Mode
//      * Toggle quantize
//      * Toggle slip
//		* Reverse play 
//++++++++++++++++++++++++++++++++++++++++++++++++++++
// Check :
//  Custom (Mixxx specific mappings):
//      * BeatFX: Assigned Effect Unit 1
//                v FX_SELECT focus EFFECT1.
//                < LEFT focus EFFECT2
//                > RIGHT focus EFFECT3
//                ON/OFF toggles focused effect slot
//                SHIFT + ON/OFF disables all three effect slots.
//                SHIFT + < loads previous effect
//                SHIFT + > loads next effect
//
//      * 32 beat jump forward & back (Shift + </> CUE/LOOP CALL arrows)
//      * Toggle quantize (Shift + channel cue)
//      * Pad FX1 (see mapping infos)
//      * Pad FX2
//+++++++++++++++++++++++++++++++++++++++++++++++++++++++++
// To fix
//
//++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
// To develop ?
//      * Loop Section:
//        * -4BEAT auto loop (hacky---prefer a clean way to set a 4 beat loop
//                            from a previous position on long press)
//
//        * CUE/LOOP CALL - memory & delete (complex and not useful. Hot cues are sufficient)
//
//      * Secondary pad modes (trial attempts complex and too experimental)
//        * Keyboard mode

//        * Keyshift mode
//++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

// Global variables
var PioneerDDJFLX10 = {};

// Global state
PioneerDDJFLX10.shiftActive = false;
PioneerDDJFLX10._rateMSB = {1: 0, 2: 0, 3: 0, 4: 0};
PioneerDDJFLX10._rateLSB = {1: 0, 2: 0, 3: 0, 4: 0};
PioneerDDJFLX10._jogTouches = {1: false, 2: false, 3: false, 4: false};
PioneerDDJFLX10._jogLastValue = {1: 0, 2: 0, 3: 0, 4: 0};
PioneerDDJFLX10._reverseSlipActive = {1: false, 2: false, 3: false, 4: false};
PioneerDDJFLX10._currentTimeMode = {1: 0, 2: 0, 3: 0, 4: 0}; // 0=Remaining, 1=Elapsed
PioneerDDJFLX10._lastShiftPress = 0;

// Utility function to extract deck number from group
PioneerDDJFLX10._getDeckFromGroup = function(group) {
    var match = group.match(/\d+/);
    return match ? parseInt(match[0], 10) : 1;
};

// Initialization
PioneerDDJFLX10.init = function(id) {
    print("Pioneer DDJ-FLX10 PROD - Initialisation");
    
    // Initialize channels
    for (var i = 1; i <= 4; i++) {
        var group = "[Channel" + i + "]";
        
        // Update initial feedbacks
        PioneerDDJFLX10.updateLEDs(group, i);
    }
    
    return true;

	PioneerDDJFLX10.syncHotcueLEDs();
};

// Shutdown
PioneerDDJFLX10.shutdown = function() {
    print("Pioneer DDJ-FLX10 PROD - Arrêt");
    
    // Turn off all LEDs
    for (var i = 1; i <= 4; i++) {
        var group = "[Channel" + i + "]";
        midi.sendShortMsg(0x90 + (i-1), 0x00, 0x00); // Cue LED off
        // Add other LEDs to turn off if needed
    }
};

// Tempo management (14-bit)
PioneerDDJFLX10.rate_msb = function(channel, control, value, status, group) {
    var deck = PioneerDDJFLX10._getDeckFromGroup(group);
    PioneerDDJFLX10._rateMSB[deck] = value;
    PioneerDDJFLX10._updateRate(deck);
};

PioneerDDJFLX10.rate_lsb = function(channel, control, value, status, group) {
    var deck = PioneerDDJFLX10._getDeckFromGroup(group);
    PioneerDDJFLX10._rateLSB[deck] = value;
    PioneerDDJFLX10._updateRate(deck);
};

PioneerDDJFLX10._updateRate = function(deck) {
    var group = "[Channel" + deck + "]";
    var msb = PioneerDDJFLX10._rateMSB[deck];
    var lsb = PioneerDDJFLX10._rateLSB[deck];
    
    // Combine MSB and LSB for 14-bit value (0-16383)
    var value = (msb << 7) | lsb;
    
    // Reverse direction: 16383 = +8%, 0 = -8%
    var rate = (8192 - value) / 8192.0; // Reverse direction
    
    // Limit range to ±8%
    rate = rate * 0.08;
    
    // Apply rate to track
    engine.setValue(group, "rate", rate);
};

// Jog Wheel Management
PioneerDDJFLX10.wheelTurn = function(channel, control, value, status, group) {
    var newValue = value - 64;
    var deckNumber = script.deckFromGroup(group);
    
    print("wheelTurn: deck " + deckNumber + " value " + newValue + " isScratching " + engine.isScratching(deckNumber)); // Debug
    
    if (engine.isScratching(deckNumber)) {
        // Scratch mode
        var scratchValue = PioneerDDJFLX10.sensitivityMaximizer(newValue, 1.5);
        print("Scratching with value " + scratchValue); // Debug
        engine.scratchTick(deckNumber, scratchValue);
    } else {
        // Pitch bend mode - using working implementation from Untitled-1.js
        var bendValue = PioneerDDJFLX10.sensitivityMinimizer(newValue, 16);
        print("Pitch bend with value " + bendValue); // Debug
        engine.setValue(group, 'jog', bendValue);
    }
};

PioneerDDJFLX10.wheelTouch = function(channel, control, value, status, group) {
    var deckNumber = script.deckFromGroup(group);
    
    if (value == 0x7F) {
        // Enable scratch mode
        var alpha = 1.0/8;
        var beta = alpha/32;
        print("Enabling scratch for deck " + deckNumber + " group " + group); // Debug
        engine.scratchEnable(deckNumber, 32767, 33+1/3, alpha, beta);
    } else {
        // Disable scratch mode
        print("Disabling scratch for deck " + deckNumber + " group " + group); // Debug
        engine.scratchDisable(deckNumber);
    }
};

// Sensitivity functions
PioneerDDJFLX10.sensitivityMinimizer = function (value, factor) {
    return (value/factor);
};

PioneerDDJFLX10.sensitivityMaximizer = function (value, factor) {
    return (value*factor);
};

// Shift buttons management
PioneerDDJFLX10.shiftHandler = function(channel, control, value, status, group) {
    PioneerDDJFLX10.shiftActive = (value === 0x7F);
    var now = new Date().getTime();
    
    // Detect double-click (within 300ms)
    if (PioneerDDJFLX10.shiftActive && (now - PioneerDDJFLX10._lastShiftPress) < 300) {
        PioneerDDJFLX10._handleDoubleShift();
    }
    
    PioneerDDJFLX10._lastShiftPress = now;
    
    // Update LEDs
    for (var i = 1; i <= 4; i++) {
        PioneerDDJFLX10.updateLEDs("[Channel" + i + "]", i);
    }
};

PioneerDDJFLX10.shift = function(channel, control, value, status, group) {
    PioneerDDJFLX10.shiftHandler(channel, control, value, status, group);
};

// Reverse with slip mode management
PioneerDDJFLX10.reverse = function(channel, control, value, status, group) {
    var deck = PioneerDDJFLX10._getDeckFromGroup(group);
    
    if (value === 0x7F) { // Button pressed
        if (PioneerDDJFLX10.shiftActive) {
            // Toggle current state
            var currentReverse = engine.getValue(group, "reverse") || 0;
            engine.setValue(group, "reverse", currentReverse ? 0 : 1);
            engine.setValue(group, "slip_enabled", 0); // Disable slip mode
        } else {
            // Enable slip mode and reverse
            engine.setValue(group, "slip_enabled", 1);
            engine.setValue(group, "reverse", 1);
            PioneerDDJFLX10._reverseSlipActive[deck] = true;
        }
    } else if (value === 0x00 && PioneerDDJFLX10._reverseSlipActive[deck]) {
        // Button release with slip mode active
        engine.setValue(group, "reverse", 0);
        engine.setValue(group, "slip_enabled", 0);
        PioneerDDJFLX10._reverseSlipActive[deck] = false;
    }
};

// Loop buttons management
PioneerDDJFLX10.loopIn = function(channel, control, value, status, group) {
    if (value === 0x7F) {
        if (PioneerDDJFLX10.shiftActive) {
            engine.setValue(group, "loop_halve", 1);
        } else {
            engine.setValue(group, "loop_in", 1);
        }
    }
};

PioneerDDJFLX10.loopOut = function(channel, control, value, status, group) {
    if (value === 0x7F) {
        if (PioneerDDJFLX10.shiftActive) {
            engine.setValue(group, "loop_double", 1);
        } else {
            engine.setValue(group, "loop_out", 1);
        }
    }
};

// Beatjump functions removed - now using native Mixxx beatjump_forward/backward controls

// Browse navigation functions - RESTORED for PROD version
PioneerDDJFLX10.browseNavigation = function(channel, control, value, status, group) {
    if (value === 0x7F) {
        // Navigate based on control value
        var midino = control & 0x7F; // Extract MIDI note number
        switch(midino) {
            case 0x10: // Back button
                engine.setValue("[Library]", "MoveFocusBackward", 1);
                break;
            case 0x11: // View button
                engine.setValue("[Library]", "MoveFocusForward", 1);
                break;
            default:
                print("Unknown browse navigation control: " + midino);
        }
    }
};

// Loop functions with shift support - RESTORED for PROD version
PioneerDDJFLX10.LoopHalveShift = function(channel, control, value, status, group) {
    if (value === 0x7F) {
        if (PioneerDDJFLX10.shiftActive) {
            engine.setValue(group, "loop_halve", 1);
        } else {
            engine.setValue(group, "loop_in", 1);
        }
    }
};

PioneerDDJFLX10.LoopDoubleShift = function(channel, control, value, status, group) {
    if (value === 0x7F) {
        if (PioneerDDJFLX10.shiftActive) {
            engine.setValue(group, "loop_double", 1);
        } else {
            engine.setValue(group, "loop_out", 1);
        }
    }
};

// Rate range selector - RESTORED for PROD version
PioneerDDJFLX10.RangeSelector = function(channel, control, value, status, group) {
    if (value === 0x7F) {
        // Toggle between different rate ranges
        var currentRateRange = engine.getValue(group, "rateRange") || 0;
        var newRateRange = (currentRateRange + 1) % 4; // Cycle through 4 ranges
        engine.setValue(group, "rateRange", newRateRange);
    }
};

// Time display mode management
PioneerDDJFLX10.TimeTypeChange = function(channel, control, value, status, group) {
    if (value === 0x7F) {
        var deck = PioneerDDJFLX10._getDeckFromGroup(group);
        PioneerDDJFLX10._currentTimeMode[deck] = (PioneerDDJFLX10._currentTimeMode[deck] + 1) % 2;
        PioneerDDJFLX10._updateTimeMode(group, deck);
    }
};

PioneerDDJFLX10._updateTimeMode = function(group, deck) {
    var timeMode = PioneerDDJFLX10._currentTimeMode[deck];
    engine.setValue(group, "show_seconds_elapsed", timeMode === 1);
};

// Sync button management
PioneerDDJFLX10.syncKey = function(channel, control, value, status, group) {
    if (value === 0x7F) {
        if (PioneerDDJFLX10.shiftActive) {
            // BPM Sync
            engine.setValue(group, "beatsync", 1);
        } else {
            // Normal sync
            engine.setValue(group, "beatsync", 1);
        }
    }
};

// Cue button management
PioneerDDJFLX10.cue = function(channel, control, value, status, group) {
    if (value === 0x7F) {
        if (PioneerDDJFLX10.shiftActive) {
            // Set cue point
            engine.setValue(group, "cue_set", 1);
        } else {
            // Toggle cue point
            engine.setValue(group, "cue_default", 1);
        }
    }
};

// Play/Pause button management
PioneerDDJFLX10.play = function(channel, control, value, status, group) {
    if (value === 0x7F) {
        var isPlaying = engine.getValue(group, "play");
        engine.setValue(group, "play", isPlaying ? 0 : 1);
    }
};

// Update LEDs
PioneerDDJFLX10.Play = function(channel, control, value, status, group) {
    var deck = PioneerDDJFLX10._getDeckFromGroup(group);
    
    if (value === 0x7F) {
        var isPlaying = engine.getValue(group, "play");
        engine.setValue(group, "play", isPlaying ? 0 : 1);
    }
};

PioneerDDJFLX10.updateLEDs = function(group, deck) {
    var channel = 0x90 + (deck - 1);
    
    // Update Cue LED
    var cueActive = engine.getValue(group, "cue_indicator") ? 0x7F : 0x00;
    midi.sendShortMsg(channel, 0x00, cueActive);
    
    // Update Play LED/Pause
    var isPlaying = engine.getValue(group, "play") ? 0x7F : 0x00;
    midi.sendShortMsg(channel, 0x01, isPlaying);
    
    // Update Cue LED (button)
    midi.sendShortMsg(channel, 0x02, cueActive);
    
    // Update Sync LED
    var syncActive = engine.getValue(group, "sync_enabled") ? 0x7F : 0x00;
    midi.sendShortMsg(channel, 0x03, syncActive);
    
    // Update loop LEDs
    var loopActive = engine.getValue(group, "loop_enabled") ? 0x7F : 0x00;
    midi.sendShortMsg(channel, 0x04, loopActive);
};

// Tempo reset button management
PioneerDDJFLX10.rate_reset = function(channel, control, value, status, group) {
    if (value === 0x7F) {
        engine.setValue(group, "rate_set_default", 1);
        
        // Reset internal values
        var deck = PioneerDDJFLX10._getDeckFromGroup(group);
        PioneerDDJFLX10._rateMSB[deck] = 0x40; // Center value (0x40 = 64)
        PioneerDDJFLX10._rateLSB[deck] = 0x00;
    }
};

// PFL/Headphone button management
PioneerDDJFLX10.pfl = function(channel, control, value, status, group) {
    if (value === 0x7F) {
        var currentPFL = engine.getValue(group, "pfl");
        engine.setValue(group, "pfl", currentPFL ? 0 : 1);
    }
};

// Loop Out button management
PioneerDDJFLX10.loopOutButton = function(channel, control, value, status, group) {
    if (value === 0x7F) {
        if (PioneerDDJFLX10.shiftActive) {
            // Toggle 4-beat loop
            var loopEnabled = engine.getValue(group, "loop_enabled");
            if (!loopEnabled) {
                engine.setValue(group, "beatloop_4_enabled", 1);
            } else {
                engine.setValue(group, "loop_enabled", 0);
            }
        } else {
            // Exit current loop
            engine.setValue(group, "loop_exit", 1);
        }
    }
};

// Loop In button management
PioneerDDJFLX10.loopInButton = function(channel, control, value, status, group) {
    if (value === 0x7F) {
        if (PioneerDDJFLX10.shiftActive) {
            // Toggle 2-beat loop
            var loopEnabled = engine.getValue(group, "loop_enabled");
            if (!loopEnabled) {
                engine.setValue(group, "beatloop_2_enabled", 1);
            } else {
                engine.setValue(group, "loop_enabled", 0);
            }
        } else {
            // Toggle current loop
            var loopEnabled = engine.getValue(group, "loop_enabled");
            engine.setValue(group, "reloop_exit", loopEnabled ? 1 : 0);
        }
    }
};

// Reloop/Reload button management
PioneerDDJFLX10.reloop = function(channel, control, value, status, group) {
    if (value === 0x7F) {
        engine.setValue(group, "reloop_exit", 1);
    }
};

// Sync button management
PioneerDDJFLX10.sync = function(channel, control, value, status, group) {
    if (value === 0x7F) {
        if (PioneerDDJFLX10.shiftActive) {
            // BPM sync
            engine.setValue(group, "beatsync", 1);
        } else {
            // Tempo sync
            engine.setValue(group, "beatsync_tempo", 1);
        }
    }
};

// Play/Pause button management
PioneerDDJFLX10.playPause = function(channel, control, value, status, group) {
    if (value === 0x7F) {
        var isPlaying = engine.getValue(group, "play");
        engine.setValue(group, "play", isPlaying ? 0 : 1);
    }
};

// Cue button management
PioneerDDJFLX10.cueButton = function(channel, control, value, status, group) {
    if (value === 0x7F) {
        if (PioneerDDJFLX10.shiftActive) {
            // Set cue point
            engine.setValue(group, "cue_set", 1);
        } else {
            // Toggle cue point
            engine.setValue(group, "cue_default", 1);
        }
    }
};

// Manual Loop (In/Out) button management
PioneerDDJFLX10.loopManual = function(channel, control, value, status, group) {
    if (value === 0x7F) {
        if (PioneerDDJFLX10.shiftActive) {
            // Toggle manual loop
            var loopEnabled = engine.getValue(group, "loop_enabled");
            engine.setValue(group, "reloop_exit", loopEnabled ? 1 : 0);
        } else {
            // Toggle 4-beat loop
            var loopEnabled = engine.getValue(group, "loop_enabled");
            if (!loopEnabled) {
                engine.setValue(group, "beatloop_4_enabled", 1);
            } else {
                engine.setValue(group, "loop_enabled", 0);
            }
        }
    }
};

// Auto Loop button management
PioneerDDJFLX10.autoLoop = function(channel, control, value, status, group) {
    if (value === 0x7F) {
        if (PioneerDDJFLX10.shiftActive) {
            // Toggle 8-beat loop
            var loopEnabled = engine.getValue(group, "loop_enabled");
            if (!loopEnabled) {
                engine.setValue(group, "beatloop_8_enabled", 1);
            } else {
                engine.setValue(group, "loop_enabled", 0);
            }
        } else {
            // Toggle 16-beat loop
            var loopEnabled = engine.getValue(group, "loop_enabled");
            if (!loopEnabled) {
                engine.setValue(group, "beatloop_16_enabled", 1);
            } else {
                engine.setValue(group, "loop_enabled", 0);
            }
        }
    }
};

// Reverse handler with slip mode support
PioneerDDJFLX10.reverseHandler = function(channel, control, value, status, group) {
    var deck = parseInt(group.match(/\d+/)[0], 10);
    
    if (value === 0x7F) {
        if (PioneerDDJFLX10.shiftActive) {
            var currentReverse = engine.getValue(group, "reverse") || 0;
            engine.setValue(group, "reverse", currentReverse ? 0 : 1);
            engine.setValue(group, "slip_enabled", 0);
        } else {
            engine.setValue(group, "slip_enabled", 1);
            engine.setValue(group, "reverse", 1);
            PioneerDDJFLX10._reverseSlipActive[deck] = true;
        }
    } else if (value === 0x00 && PioneerDDJFLX10._reverseSlipActive[deck]) {
        engine.setValue(group, "reverse", 0);
        engine.setValue(group, "slip_enabled", 0);
        PioneerDDJFLX10._reverseSlipActive[deck] = false;
    }
};

// Sync key handler with shift support
PioneerDDJFLX10.syncKeyHandler = function(channel, control, value, status, group) {
    if (value === 0x7F) {
        // Key Sync (tonality synchronization) - no shift needed
        engine.setValue(group, "key_sync", 1);
    }
};

// Function to expand playlists folder (currently disabled)
// This feature requires a different approach that will be implemented later
