declare module "opening_hours" {
  export default class OpeningHours {
    constructor(value: string, nominatimObject?: Record<string, unknown>, options?: Record<string, unknown>);
    getState(date?: Date): boolean;
    getComment(date?: Date): string | undefined;
    getNextChange(date?: Date): Date | undefined;
  }
}
