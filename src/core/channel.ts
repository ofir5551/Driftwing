/**
 * Which build this is. The dev channel (built with VITE_CHANNEL=dev, served at /dev/ on GitHub
 * Pages beside the players' build) opens every level, bird, plumage and trail, saves no journey
 * (so no flock, no light: URL flags such as `?journey=N` and `?flock=N` set them per visit) and
 * keeps its settings under its own keys, so it never touches the players' save on the same site.
 */
export const DEV_CHANNEL: boolean = import.meta.env.VITE_CHANNEL === 'dev';
