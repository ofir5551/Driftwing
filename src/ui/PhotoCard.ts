/**
 * A keepsake on arrival: a photo in a white card with a name under it, fading in over the top
 * of the flight for a few seconds and away again. It never takes a tap (the flight goes on
 * under it), so it adds no button or gesture.
 */
export class PhotoCard {
  private readonly el: HTMLDivElement;
  private readonly img: HTMLImageElement;
  private readonly caption: HTMLDivElement;
  private readonly date: HTMLDivElement;
  private timer = 0;

  constructor(ui: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'photo-card';
    this.el.setAttribute('aria-live', 'polite');
    this.img = document.createElement('img');
    this.img.alt = '';
    this.img.decoding = 'async';
    this.caption = document.createElement('div');
    this.caption.className = 'photo-caption';
    this.date = document.createElement('div');
    this.date.className = 'photo-date';
    this.el.append(this.img, this.caption, this.date);
    ui.append(this.el);
  }

  /**
   * `date`: a smaller line under the caption (none: hidden). `tall`: a picture that speaks for
   * itself (an invitation), shown taller with no caption or date.
   */
  show(url: string, caption: string, seconds: number, date?: string, tall = false): void {
    this.img.src = url;
    this.img.alt = caption;
    this.caption.textContent = caption;
    this.caption.hidden = tall;
    this.date.textContent = date ?? '';
    this.date.hidden = tall || !date;
    this.el.classList.toggle('tall', tall);
    this.el.classList.add('show');
    this.timer = seconds;
  }

  hide(): void {
    this.timer = 0;
    this.el.classList.remove('show');
  }

  update(dt: number): void {
    if (this.timer <= 0) return;
    this.timer -= dt;
    if (this.timer <= 0) this.el.classList.remove('show');
  }
}
