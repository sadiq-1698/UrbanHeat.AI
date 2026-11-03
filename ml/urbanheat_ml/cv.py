"""Cross-validation with the spatial folds assigned by build_dataset, and the metrics reported for every model."""
from __future__ import annotations

from typing import Callable

import numpy as np
import pandas as pd
from sklearn.model_selection import KFold

SPIKE_C = 3.0  # an anomaly above this many degrees counts as a heat "spike"


def regression_metrics(y: np.ndarray, pred: np.ndarray, spike_c: float = SPIKE_C) -> dict:
    """RMSE / MAE / R2 / bias, plus how well the model finds the spikes (anomaly > spike_c) as a yes/no call."""
    err = pred - y
    ss_res = float(np.sum(err**2))
    ss_tot = float(np.sum((y - y.mean()) ** 2))
    true_spike, pred_spike = y > spike_c, pred > spike_c
    tp = int(np.sum(true_spike & pred_spike))
    fp = int(np.sum(~true_spike & pred_spike))
    fn = int(np.sum(true_spike & ~pred_spike))
    precision = tp / (tp + fp) if tp + fp else float("nan")
    recall = tp / (tp + fn) if tp + fn else float("nan")
    f1 = 2 * precision * recall / (precision + recall) if tp and precision == precision and recall == recall else (0.0 if tp + fp + fn else float("nan"))
    return {"n": int(len(y)), "rmse": float(np.sqrt(ss_res / len(y))), "mae": float(np.mean(np.abs(err))), "r2": 1 - ss_res / ss_tot if ss_tot > 0 else float("nan"),
            "bias": float(err.mean()), "spike_precision": precision, "spike_recall": recall, "spike_f1": f1, "spike_share": float(true_spike.mean())}


def _run(df: pd.DataFrame, features: list[str], target: str, make_model: Callable, splits, seed: int) -> dict:
    X = df[features].to_numpy(dtype="float32")
    y = df[target].to_numpy(dtype="float64")
    oof = np.full(len(df), np.nan)
    per_fold = []
    for k, (tr, te) in enumerate(splits):
        model = make_model(seed)
        model.fit(X[tr], y[tr])
        oof[te] = model.predict(X[te])
        per_fold.append({"fold": k, **regression_metrics(y[te], oof[te])})
    if np.isnan(oof).any():
        raise AssertionError("every row must be held out exactly once")
    rmses = [f["rmse"] for f in per_fold]
    return {"pooled": regression_metrics(y, oof), "per_fold": per_fold, "rmse_mean": float(np.mean(rmses)), "rmse_std": float(np.std(rmses)), "oof": oof}


def spatial_cv(df: pd.DataFrame, features: list[str], target: str, make_model: Callable, seed: int = 42, fold_col: str = "fold") -> dict:
    """Leave-regions-out: each fold holds out whole spatial blocks (assigned by build_dataset), so test cells are not neighbours of training cells."""
    folds = df[fold_col].to_numpy()
    splits = [(np.flatnonzero(folds != k), np.flatnonzero(folds == k)) for k in sorted(np.unique(folds))]
    return _run(df, features, target, make_model, splits, seed)


def random_cv(df: pd.DataFrame, features: list[str], target: str, make_model: Callable, seed: int = 42, n_splits: int = 5) -> dict:
    """Ordinary shuffled K-fold. Reported only to show how much it flatters a model on spatially autocorrelated data."""
    return _run(df, features, target, make_model, list(KFold(n_splits, shuffle=True, random_state=seed).split(df)), seed)
