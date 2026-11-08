# Bronze OTP — UI component

**[Live demo](https://domvybe.com/components/bronze-otp/)** · [Step-by-step tutorial](https://domvybe.com/library/bronze-otp/) · [Download the ZIP](https://github.com/UlviShabanbayli/domvybe-bronze-otp/releases/latest/download/bronze-otp-source.zip)

A verification-code input where every digit is poured in molten bronze: it crusts over with glowing cracks and cools through temper colours to polished metal, paste the code and all six pour at once, and the right code runs a golden light across them.

Open `index.html` through any local static server (for example `python3 -m http.server`) and try it with a mouse,
a finger or the keyboard. Plain HTML, CSS and JavaScript; no build step, no libraries.

- `index.html` — the page: the skip link, the nav (Help, Secure session), the headline, the lede, the plate with its engravings and six moulds over the one real input autocomplete=one-time-code, the timer, Resend and Verify, the status and alert lines, the caption, the toast, and a pre-paint script (old keys, ?nofx)
- `css` — bronze.css: the tile size that drives the stage (one row on landscape, a 2 x 3 grid on portrait), the focus rim, the shake, the Verify and Resend states, the CSS bronze without WebGL 2, the phone and short-landscape layouts, reduced motion
- `js` — app.js (the input: overwrite, arrows, Backspace, paste and SMS autofill; the cast model per mould; verify, attempts, lock, expiry and resend; the scheduler that sleeps at rest), foundry.js (the renderer), shaders.js (the iron plate, the moulds, the pour, the crust, the temper film and the polished numerals), atlas.js (the digit atlas and noise, built once), gl.js (the WebGL 2 helper)

Bellmont, its customer and the phone number are made up, and the page sends nothing: Verify simulates a 900 ms request
and accepts only the demo code 482913 (it is in the caption), so put your own check in `js/app.js`. Everything is made
in code: the cast-iron plate, the moulds, the pour, the crust with its glowing cracks, the temper colours and the
polished bronze are WebGL 2 shaders, and each numeral is clipped by SVG text so its edge stays sharp; every word, the
field and the buttons are HTML; no AI pictures. The six moulds sit over one real `input autocomplete=one-time-code`,
so paste and SMS autofill work. Three wrong codes lock the form for 30 s; only `dv90.v1.resendAt`, `dv90.v1.lockUntil`
and `dv90.v1.attempts` are kept in `localStorage`, never the code. The loop runs at full rate while metal moves, slower
while a casting cools, then sleeps. Without WebGL 2 (or with `?nofx`, or when the context is lost) the bronze is CSS;
`?nointro` skips the pour on load and `?fast` shortens the request. The page reads Google Fonts (Inter, Playfair
Display, Fraunces).

It respects `prefers-reduced-motion`. Made by Ulvi (Code with Ulvi) · domvybe.com

## Licence

MIT — see [LICENSE](LICENSE). Use it in your own projects, commercial ones included.
