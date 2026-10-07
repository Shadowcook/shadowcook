export interface TestClock {
  now(): Date;
}

export class FixedTestClock implements TestClock {
  private currentTime: Date;

  public constructor(initialTime: Date) {
    this.currentTime = new Date(initialTime);
  }

  public now(): Date {
    return new Date(this.currentTime);
  }

  public advance(milliseconds: number): void {
    this.currentTime = new Date(this.currentTime.getTime() + milliseconds);
  }
}

export function createSequentialTokenFactory(prefix: string): () => string {
  let sequence: number = 0;

  return (): string => {
    sequence += 1;
    return `${prefix}-${sequence.toString().padStart(4, '0')}`;
  };
}
