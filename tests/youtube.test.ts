import { it, expect } from 'vitest';
import { youtubeVideoId } from '../src/shared/youtube';

it('extracts a canonical video ID and drops author-supplied playback settings', () => {
  for (const url of [
    'https://www.youtube.com/watch?v=M7lc1UVf-VE&autoplay=1&origin=https://evil.invalid',
    'https://youtube.com/watch?v=M7lc1UVf-VE',
    'https://m.youtube.com/shorts/M7lc1UVf-VE',
    'https://youtu.be/M7lc1UVf-VE?si=tracking',
    'https://www.youtube.com/embed/M7lc1UVf-VE',
    'https://www.youtube-nocookie.com/embed/M7lc1UVf-VE',
  ])
    expect(youtubeVideoId(url)).toBe('M7lc1UVf-VE');
});

it('refuses alternate origins, credentials, unsafe schemes and ambiguous or malformed IDs', () => {
  for (const url of [
    null,
    {},
    'javascript:alert(1)',
    '//www.youtube.com/watch?v=M7lc1UVf-VE',
    'http://www.youtube.com/watch?v=M7lc1UVf-VE',
    'https://www.youtube.com.evil.invalid/watch?v=M7lc1UVf-VE',
    'https://www.youtube.com@evil.invalid/watch?v=M7lc1UVf-VE',
    'https://secret@www.youtube.com/watch?v=M7lc1UVf-VE',
    'https://www.youtube.com:444/watch?v=M7lc1UVf-VE',
    'https://www.youtube.com/watch?v=M7lc1UVf-VE&v=M7lc1UVf-VE',
    'https://www.youtube.com/watch?v=%3Cscript%3E',
    'https://youtu.be/M7lc1UVf-VE/extra',
    'https://www.youtube.com/playlist?list=M7lc1UVf-VE',
    'https://www.youtube.com/watch?v=M7lc1UVf-V',
  ])
    expect(youtubeVideoId(url)).toBeNull();
});
