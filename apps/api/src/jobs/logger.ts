/**
 * Structured logging for the worker process.
 *
 * The API logs through Fastify's built-in pino instance. The worker has no Fastify
 * instance, and reaching into `fastify`'s transitive pino dependency to get one would
 * couple this process to a package it does not declare — the kind of import that
 * breaks silently the day Fastify bumps a major.
 *
 * So: newline-delimited JSON on stdout, in pino's field shape (`level`, `time`,
 * `msg`), which means the worker's output lands in the same log aggregation as the
 * API's and can be queried with the same filters. That compatibility is the whole
 * reason for the shape; nothing here tries to be pino.
 *
 * Errors are serialised explicitly. `JSON.stringify(new Error('x'))` is `{}`, so a
 * naive logger reports a crashed job as `{"err":{}}` — which is indistinguishable
 * from no error at all, and is exactly the log line you need when a nightly purge
 * has been failing for a week.
 */

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

/** pino's numeric levels, so downstream filters on `level >= 50` keep working. */
const LEVEL_VALUES: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  fatal(fields: LogFields, message: string): void;
  error(fields: LogFields, message: string): void;
  warn(fields: LogFields, message: string): void;
  info(fields: LogFields, message: string): void;
  debug(fields: LogFields, message: string): void;
  /** A logger that stamps `fields` onto every line it writes. */
  child(fields: LogFields): Logger;
}

function serialise(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      type: value.name,
      message: value.message,
      stack: value.stack,
      ...(value.cause === undefined ? {} : { cause: serialise(value.cause) }),
    };
  }
  // BigInt appears on User.lifetimeXp and is not JSON-serialisable; a job that logs a
  // user row must not crash on the log line.
  if (typeof value === 'bigint') return value.toString();
  return value;
}

export interface LoggerOptions {
  readonly level: LogLevel;
  readonly name: string;
  /** Overridden by tests so assertions do not depend on stdout. */
  readonly write?: ((line: string) => void) | undefined;
}

export function createLogger(options: LoggerOptions): Logger {
  const threshold = LEVEL_VALUES[options.level];
  const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));

  function build(base: LogFields): Logger {
    function emit(level: LogLevel, fields: LogFields, message: string): void {
      if (LEVEL_VALUES[level] < threshold) return;

      const payload: Record<string, unknown> = {
        level: LEVEL_VALUES[level],
        time: Date.now(),
        name: options.name,
        msg: message,
      };
      for (const [key, value] of Object.entries({ ...base, ...fields })) {
        payload[key] = serialise(value);
      }
      write(JSON.stringify(payload));
    }

    return {
      fatal: (fields, message) => emit('fatal', fields, message),
      error: (fields, message) => emit('error', fields, message),
      warn: (fields, message) => emit('warn', fields, message),
      info: (fields, message) => emit('info', fields, message),
      debug: (fields, message) => emit('debug', fields, message),
      child: (fields) => build({ ...base, ...fields }),
    };
  }

  return build({});
}
