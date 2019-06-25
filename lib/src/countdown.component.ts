import {
  Component,
  ElementRef,
  Input,
  OnChanges,
  SimpleChanges,
  OnDestroy,
  Output,
  EventEmitter,
  OnInit,
  SimpleChange,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  Inject,
} from '@angular/core';

import { Config, Hand } from './interfaces';
import { Timer } from './countdown.timer';
import { CountdownConfig } from './countdown.config';

@Component({
  selector: 'countdown',
  template: `
    <ng-content></ng-content>
  `,
  styles: [
    `
      countdown {
        display: none;
      }
    `,
  ],
  host: { '[class.count-down]': 'true' },
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CountdownComponent implements OnInit, OnChanges, OnDestroy {
  private frequency = 1000;
  private _notify: any = {};
  private hands: Hand[] = [];
  public left = 0;
  private paused = false;
  /** 两种情况会触发：时间终止或调用 `stop()` */
  private stoped = false;

  @Input()
  config: Config;
  @Output()
  readonly start = new EventEmitter();
  @Output()
  readonly finished = new EventEmitter();
  @Output()
  readonly notify = new EventEmitter();
  @Output()
  readonly event = new EventEmitter<{ action: string; left: number }>();

  constructor(
    private el: ElementRef,
    private timer: Timer,
    private cog: CountdownConfig,
  ) {}

  /** 开始，当 `demand: false` 时触发 */
  begin() {
    this.paused = false;
    this.start.emit();
    this.callEvent('start');
  }

  /** 重新开始 */
  restart(): void {
    if (!this.stoped) this.destroy();
    this.init();
    this.callEvent('restart');
  }

  /** 停止 */
  stop() {
    if (this.stoped) return;
    this.stoped = true;
    this.destroy();
    this.callEvent('stop');
  }

  /** 暂停（限未终止有效） */
  pause() {
    if (this.stoped || this.paused) return;
    this.paused = true;
    this.callEvent('pause');
  }

  /** 恢复 */
  resume() {
    if (this.stoped || !this.paused) return;
    this.paused = false;
    this.callEvent('resume');
  }

  private callEvent(action: string) {
    this.event.emit({ action, left: this.left });
  }

  private init() {
    const me = this;
    me.config = { ...new CountdownConfig(), ...me.cog, ...me.config };
    const el = me.el.nativeElement as HTMLElement;
    me.paused = me.config.demand;
    me.stoped = false;

    // 分析markup
    const tmpl = el.innerHTML || me.config.template;
    me.config.varRegular.lastIndex = 0;
    el.innerHTML = tmpl.replace(
      me.config.varRegular,
      (str: string, type: string) => {
        // 时钟频率校正.
        if (type === 'u' || type === 's-ext') me.frequency = 100;

        // 生成hand的markup
        let content = '';
        if (type === 's-ext') {
          me.hands.push({ type: 's' });
          me.hands.push({ type: 'u' });
          content =
            me.html('', 's', 'handlet') +
            me.html('.', '', 'digital') +
            me.html('', 'u', 'handlet');
        } else {
          me.hands.push({ type: type });
        }

        return me.html(content, type, 'hand');
      },
    );

    const clock = me.config.clock;
    me.hands.forEach((hand: Hand) => {
      const type = hand.type;
      let base = 100,
        i: number;

      hand.node = el.querySelector(`.hand-${type}`);
      // radix, bits 初始化
      for (i = clock.length - 3; i > -1; i -= 3) {
        if (type === clock[i]) {
          break;
        }

        base *= clock[i + 1];
      }
      hand.base = base;
      hand.radix = clock[i + 1];
      hand.bits = clock[i + 2];
    });

    me.getLeft();
    me.reflow(0, true);

    // bind reflow to me
    const _reflow = me.reflow;
    me.reflow = (count: number = 0) => {
      return _reflow.apply(me, [count]);
    };

    // 构建 notify
    if (me.config.notify) {
      me.config.notify.forEach((time: number) => {
        if (time < 1)
          throw new Error(`the notify config must be a positive integer.`);
        time = time * 1000;
        time = time - (time % me.frequency);
        me._notify[time] = true;
      });
    }

    me.timer.add(me.reflow, me.frequency);
    // show
    el.style.display = 'inline';

    this.timer.start();

    return me;
  }

  private destroy() {
    this.timer.remove(this.reflow);
    return this;
  }

  /**
   * 更新时钟
   */
  private reflow(count: number = 0, force: boolean = false): void {
    const me = this;
    if (!force && (me.paused || me.stoped)) return;
    me.left = me.left - me.frequency * count;

    me.hands.forEach((hand: Hand) => {
      hand.lastValue = hand.value;
      hand.value = Math.floor(me.left / hand.base) % hand.radix;
    });

    me.repaint();

    if (me._notify[me.left]) {
      me.notify.emit(me.left);
      me.callEvent('notify');
    }

    if (me.left < 1) {
      me.finished.emit(0);
      me.stoped = true;
      me.callEvent('finished');
      me.destroy();
    }
  }

  /**
   * 重绘时钟
   */
  private repaint(): void {
    const me = this;
    if (me.config.repaint) {
      me.config.repaint.apply(me);
      return;
    }

    let content: string;

    me.hands.forEach((hand: Hand) => {
      if (hand.lastValue !== hand.value) {
        content = '';

        me.toDigitals(hand.value, hand.bits).forEach((digital: number) => {
          content += me.html(digital.toString(), '', 'digital');
        });

        hand.node.innerHTML = content;
      }
    });
  }

  /**
   * 获取倒计时剩余帧数
   */
  private getLeft(): void {
    const me = this;
    let left: number = me.config.leftTime * 1000;
    const end: number = me.config.stopTime;

    if (!left && end) left = end - new Date().getTime();

    me.left = left - (left % me.frequency);
  }

  /**
   * 生成需要的html代码，辅助工具
   */
  private html(con: string, className: string, type: string): string {
    switch (type) {
      case 'hand':
      case 'handlet':
        className = type + ' hand-' + className;
        break;
      case 'digital':
        if (con === '.') {
          className = type + ' ' + type + '-point ' + className;
        } else {
          className = type + ' ' + type + '-' + con + ' ' + className;
        }
        break;
    }
    return '<span class="' + className + '">' + con + '</span>';
  }

  /**
   * 把值转换为独立的数字形式
   */
  private toDigitals(value: number, bits: number): number[] {
    value = value < 0 ? 0 : value;
    const digitals = [];
    // 把时、分、秒等换算成数字.
    while (bits--) {
      digitals[bits] = value % 10;
      value = Math.floor(value / 10);
    }
    return digitals;
  }

  ngOnInit() {
    this.init();
    if (!this.config.demand) this.begin();
  }

  ngOnDestroy(): void {
    this.destroy();
  }

  ngOnChanges(
    changes: { [P in keyof this]?: SimpleChange } & SimpleChanges,
  ): void {
    if (!changes.config.firstChange) {
      this.restart();
    }
  }
}
