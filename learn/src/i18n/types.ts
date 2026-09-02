export interface ConceptCopy {
  readonly title: string;
  readonly plain: string;
  readonly technical?: string;
  readonly why?: string;
  readonly tradeoffs?: string;
  readonly failure?: string;
  readonly advantages?: readonly string[];
  readonly disadvantages?: readonly string[];
  readonly alternatives?: readonly string[];
  readonly safetyImpact?: string;
  readonly tryIt?: string;
}

export interface UiStrings {
  readonly levels: Readonly<Record<'plain' | 'technical' | 'code', string>>;
  readonly passport: {
    readonly what: string;
    readonly why: string;
    readonly plain: string;
    readonly technical: string;
    readonly advantages: string;
    readonly disadvantages: string;
    readonly alternatives: string;
    readonly tradeoffs: string;
    readonly failure: string;
    readonly safetyImpact: string;
    readonly tests: string;
    readonly tryIt: string;
    readonly source: string;
    readonly test: string;
    readonly viewSource: string;
    readonly viewTest: string;
    readonly close: string;
  };
  readonly facts: Readonly<
    Record<'implemented' | 'rationale' | 'alternative' | 'simulation' | 'measured', string>
  >;
  readonly explorer: {
    readonly search: string;
    readonly resetLayout: string;
    readonly resetView: string;
    readonly fit: string;
    readonly nodeList: string;
    readonly upstream: string;
    readonly downstream: string;
    readonly noSelection: string;
  };
  readonly story: {
    readonly title: string;
    readonly previous: string;
    readonly next: string;
    readonly play: string;
    readonly pause: string;
    /** Composed as "{step} {n} {of} {total}" — never a function: Astro's
     * client-hydration props are serialized to JSON, which silently drops
     * function values, so all i18n data must stay plain strings/numbers. */
    readonly step: string;
    readonly of: string;
  };
  readonly lab: {
    readonly simulation: string;
    readonly connected: string;
    readonly disconnected: string;
    readonly noGamepad: string;
    readonly experimentValues: string;
    readonly latency: string;
    readonly resetDefaults: string;
    readonly cutConnection: string;
    readonly restoreConnection: string;
    readonly reconnectController: string;
    readonly emergencyStop: string;
    readonly stages: Readonly<
      Record<
        | 'input'
        | 'ownership'
        | 'profile'
        | 'engine'
        | 'sender'
        | 'frame'
        | 'relay'
        | 'firmware'
        | 'mix'
        | 'ack'
        | 'rtt',
        string
      >
    >;
  };
}
