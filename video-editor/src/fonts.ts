// Brand fonts, bundled from @fontsource so renders never depend on what is installed on the machine.
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/800.css';
import '@fontsource/caveat/600.css';
import '@fontsource/dancing-script/600.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/anton/400.css';
import '@fontsource/playfair-display/600-italic.css';
import { continueRender, delayRender } from 'remotion';

const faces = [
  '400 40px "Instrument Serif"',
  'italic 400 40px "Instrument Serif"',
  '400 40px Inter',
  '600 40px Inter',
  '800 40px Inter',
  '600 40px Caveat',
  '600 40px "Dancing Script"',
  '600 40px Fredoka',
  '400 40px Anton',
  'italic 600 40px "Playfair Display"',
];

if (typeof document !== 'undefined') {
  const handle = delayRender('Loading brand fonts');
  Promise.all(faces.map((f) => document.fonts.load(f)))
    .catch(() => undefined)
    .then(() => continueRender(handle));
}
