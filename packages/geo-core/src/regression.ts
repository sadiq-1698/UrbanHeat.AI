/** Small ridge-regularized ordinary least squares, for fitting a handful of covariates at a few stations. */

export interface LinearModel {
  /** [intercept, ...one per feature], in the original (unstandardized) feature units. */
  coefficients: number[];
  /** Coefficient of determination on the training data (NaN if y has no variance). */
  r2: number;
  /** Root-mean-square training residual. */
  rmse: number;
  n: number;
}

export interface FitOptions {
  /**
   * Ridge penalty on the standardized coefficients (not the intercept). Keeps the fit finite when features are
   * collinear or there are fewer samples than features. Default 1e-3.
   */
  ridge?: number;
}

/** Solve A x = b for symmetric positive-definite A by Cholesky factorization. */
function choleskySolve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const L = A.map((row) => row.map(() => 0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i]![j]!;
      for (let k = 0; k < j; k++) s -= L[i]![k]! * L[j]![k]!;
      if (i === j) {
        if (s <= 1e-12) throw new Error("matrix is not positive definite");
        L[i]![j] = Math.sqrt(s);
      } else L[i]![j] = s / L[j]![j]!;
    }
  }
  const z = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = b[i]!;
    for (let k = 0; k < i; k++) s -= L[i]![k]! * z[k]!;
    z[i] = s / L[i]![i]!;
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = z[i]!;
    for (let k = i + 1; k < n; k++) s -= L[k]![i]! * x[k]!;
    x[i] = s / L[i]![i]!;
  }
  return x;
}

/**
 * Fit y ≈ b0 + Σ bj·xj. Features are standardized internally (so the ridge penalty treats them equally and the
 * solve is well conditioned) and the coefficients are mapped back to original units. A constant feature gets
 * coefficient 0.
 */
export function fitLinear(X: readonly (readonly number[])[], y: readonly number[], { ridge = 1e-3 }: FitOptions = {}): LinearModel {
  const n = y.length;
  if (n === 0) throw new RangeError("fitLinear needs at least one sample");
  if (X.length !== n) throw new RangeError("X and y must have the same number of rows");
  const p = X[0]!.length;
  if (X.some((r) => r.length !== p)) throw new RangeError("all rows of X must have the same length");
  if (![...y, ...X.flat()].every(Number.isFinite)) throw new RangeError("fitLinear inputs must be finite");

  const mean = Array.from({ length: p }, (_, j) => X.reduce((s, r) => s + r[j]!, 0) / n);
  const sd = Array.from({ length: p }, (_, j) => Math.sqrt(X.reduce((s, r) => s + (r[j]! - mean[j]!) ** 2, 0) / n));
  const yMean = y.reduce((a, b) => a + b, 0) / n;

  // Standardized design (constant columns become all zeros and are dropped from the solve).
  const active = sd.map((s, j) => (s > 1e-12 ? j : -1)).filter((j) => j >= 0);
  const Z = X.map((r) => active.map((j) => (r[j]! - mean[j]!) / sd[j]!));
  const m = active.length;

  let beta = new Array<number>(m).fill(0);
  if (m > 0) {
    // Centered normal equations: the intercept is yMean, so no intercept row/column is needed.
    const A = Array.from({ length: m }, (_, a) => Array.from({ length: m }, (_, b) => Z.reduce((s, r) => s + r[a]! * r[b]!, 0) + (a === b ? ridge * n : 0)));
    const rhs = Array.from({ length: m }, (_, a) => Z.reduce((s, r, i) => s + r[a]! * (y[i]! - yMean), 0));
    beta = choleskySolve(A, rhs);
  }

  const coefficients = new Array<number>(p + 1).fill(0);
  let intercept = yMean;
  active.forEach((j, k) => {
    coefficients[j + 1] = beta[k]! / sd[j]!;
    intercept -= coefficients[j + 1]! * mean[j]!;
  });
  coefficients[0] = intercept;

  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const pred = predictLinear({ coefficients } as LinearModel, X[i]!);
    ssRes += (y[i]! - pred) ** 2;
    ssTot += (y[i]! - yMean) ** 2;
  }
  return { coefficients, r2: ssTot > 1e-12 ? 1 - ssRes / ssTot : NaN, rmse: Math.sqrt(ssRes / n), n };
}

export function predictLinear(model: Pick<LinearModel, "coefficients">, x: readonly number[]): number {
  const c = model.coefficients;
  if (x.length !== c.length - 1) throw new RangeError(`expected ${c.length - 1} features, got ${x.length}`);
  let v = c[0]!;
  for (let j = 0; j < x.length; j++) v += c[j + 1]! * x[j]!;
  return v;
}
