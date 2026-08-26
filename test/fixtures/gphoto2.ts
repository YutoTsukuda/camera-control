/**
 * gphoto2 の出力フィクスチャ。
 *
 * 書式は gphoto2 バイナリの書式文字列から確定させたもの:
 *   Label: %s / Readonly: %d / Type: ... / Current: %s / Choice: %d %s
 * gphoto2 2.5.28 は END を出力しないため、区切りは「次のパス行」。
 * 新しい版は END を出すので、両方の書式をフィクスチャで持つ。
 */

/** END 区切りなし（gphoto2 2.5.28 系）。 */
export const LIST_ALL_CONFIG = `/main/status/batterylevel
Label: Battery Level
Readonly: 1
Type: TEXT
Current: 78%
/main/imgsettings/iso
Label: ISO Speed
Readonly: 0
Type: RADIO
Current: 400
Choice: 0 Auto
Choice: 1 125
Choice: 2 160
Choice: 3 200
Choice: 4 250
Choice: 5 400
Choice: 6 800
Choice: 7 1600
Choice: 8 3200
Choice: 9 6400
Choice: 10 12800
/main/imgsettings/whitebalance
Label: WhiteBalance
Readonly: 0
Type: RADIO
Current: Automatic
Choice: 0 Automatic
Choice: 1 Daylight
Choice: 2 Fluorescent Lamp 1
Choice: 3 Fluorescent Lamp 2
Choice: 4 Fluorescent Lamp 3
Choice: 5 Tungsten
Choice: 6 Shade
Choice: 7 Color Temperature
/main/imgsettings/imageformat
Label: Image Format
Readonly: 0
Type: RADIO
Current: Fine
Choice: 0 Fine
Choice: 1 Normal
Choice: 2 RAW
Choice: 3 RAW + Fine
Choice: 4 RAW + Normal
/main/capturesettings/f-number
Label: F-Number
Readonly: 0
Type: RADIO
Current: f/5.6
Choice: 0 f/2
Choice: 1 f/2.2
Choice: 2 f/2.5
Choice: 3 f/2.8
Choice: 4 f/3.2
Choice: 5 f/3.6
Choice: 6 f/4
Choice: 7 f/5.6
Choice: 8 f/8
Choice: 9 f/11
Choice: 10 f/16
/main/capturesettings/shutterspeed
Label: Shutter Speed
Readonly: 0
Type: RADIO
Current: 1/125
Choice: 0 30
Choice: 1 15
Choice: 2 4
Choice: 3 1
Choice: 4 1/8
Choice: 5 1/30
Choice: 6 1/60
Choice: 7 1/125
Choice: 8 1/250
Choice: 9 1/500
Choice: 10 1/1000
Choice: 11 1/2000
Choice: 12 1/4000
Choice: 13 Bulb
/main/capturesettings/exposurecompensation
Label: Exposure Compensation
Readonly: 0
Type: RADIO
Current: 0
Choice: 0 -2
Choice: 1 -5/3
Choice: 2 -1
Choice: 3 -1/3
Choice: 4 0
Choice: 5 1/3
Choice: 6 1
Choice: 7 5/3
Choice: 8 2
/main/capturesettings/expprogram
Label: Exposure Program
Readonly: 0
Type: RADIO
Current: A
Choice: 0 M
Choice: 1 P
Choice: 2 A
Choice: 3 S
/main/capturesettings/exposuremetermode
Label: Exposure Metering Mode
Readonly: 0
Type: RADIO
Current: Multi
Choice: 0 Average
Choice: 1 Center Weighted
Choice: 2 Multi
Choice: 3 Spot
/main/capturesettings/focusmode
Label: Focus Mode
Readonly: 1
Type: RADIO
Current: AF-S
Choice: 0 Manual
Choice: 1 AF-S
Choice: 2 AF-C
/main/capturesettings/filmsimulation
Label: Film Simulation
Readonly: 0
Type: RADIO
Current: Provia/Standard
Choice: 0 Provia/Standard
Choice: 1 Velvia/Vivid
Choice: 2 Astia/Soft
Choice: 3 Classic Chrome
Choice: 4 Pro Neg. Hi
Choice: 5 Pro Neg. Std
Choice: 6 Classic Neg.
Choice: 7 Nostalgic Neg.
Choice: 8 Eterna/Cinema
Choice: 9 Eterna Bleach Bypass
Choice: 10 Reala Ace
Choice: 11 Acros
Choice: 12 Acros+Ye
Choice: 13 Acros+R
Choice: 14 Acros+G
Choice: 15 Monochrome
Choice: 16 Monochrome+Ye
Choice: 17 Monochrome+R
Choice: 18 Monochrome+G
Choice: 19 Sepia
/main/capturesettings/highlighttone
Label: Highlight Tone
Readonly: 0
Type: RADIO
Current: 0
Choice: 0 -2
Choice: 1 -1.5
Choice: 2 -1
Choice: 3 -0.5
Choice: 4 0
Choice: 5 +0.5
Choice: 6 +1
Choice: 7 +2
Choice: 8 +3
Choice: 9 +4
/main/capturesettings/shadowtone
Label: Shadow Tone
Readonly: 0
Type: RADIO
Current: 0
Choice: 0 -2
Choice: 1 -1
Choice: 2 0
Choice: 3 +1
Choice: 4 +2
Choice: 5 +3
Choice: 6 +4
/main/capturesettings/sharpness
Label: Sharpness
Readonly: 0
Type: RANGE
Current: 0
Bottom: -4
Top: 4
Step: 1
/main/imgsettings/whitebalanceadjusta
Label: White Balance Adjust A
Readonly: 0
Type: RANGE
Current: 0
Bottom: -9
Top: 9
Step: 1
/main/imgsettings/whitebalanceadjustb
Label: White Balance Adjust B
Readonly: 0
Type: RANGE
Current: 0
Bottom: -9
Top: 9
Step: 1
/main/imgsettings/colortemperature
Label: Color Temperature
Readonly: 0
Type: RANGE
Current: 5500
Bottom: 2500
Top: 10000
Step: 100
/main/other/d001
Label: PTP Property 0xd001
Readonly: 0
Type: TEXT
Current: 1
`;

/** END 区切りあり（新しめの gphoto2）。パーサが両対応であることの確認用。 */
export const LIST_ALL_CONFIG_WITH_END = `/main/capturesettings/f-number
Label: F-Number
Readonly: 0
Type: RADIO
Current: f/2.8
Choice: 0 f/2
Choice: 1 f/2.8
END
/main/capturesettings/burstnumber
Label: Burst Number
Readonly: 0
Type: RANGE
Current: 1
Bottom: 1
Top: 100
Step: 1
END
`;

export const AUTO_DETECT = `Model                          Port
----------------------------------------------------------
Fujifilm X100VI                usb:001,009
`;

export const AUTO_DETECT_EMPTY = `Model                          Port
----------------------------------------------------------
`;
