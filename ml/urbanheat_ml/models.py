"""Model factories. Hyperparameters are fixed, deliberately modest defaults (no search): the point of Session 14 is an honest,
spatially validated comparison, not squeezing the last 1% out of a synthetic dataset."""
from __future__ import annotations

from sklearn.dummy import DummyRegressor
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from xgboost import XGBRegressor

from .features import FEATURE_NAMES


def monotone_constraints(features=FEATURE_NAMES) -> tuple[int, ...]:
    """Physics prior for XGBoost: more canopy never makes a cell hotter (-1), more impervious cover never makes it cooler (+1).
    Other features are unconstrained. This keeps scenario edits ("remove the trees here") from producing nonsense."""
    return tuple(-1 if f.startswith("canopy") else 1 if f.startswith("impervious") else 0 for f in features)


def make_mean_baseline():
    return DummyRegressor(strategy="mean")


def make_ridge():
    return make_pipeline(StandardScaler(), Ridge(alpha=1.0))


def make_random_forest(seed: int = 42, **overrides):
    params = dict(n_estimators=300, min_samples_leaf=5, max_features=0.5, n_jobs=-1, random_state=seed)
    return RandomForestRegressor(**{**params, **overrides})


def make_xgboost(seed: int = 42, monotone: bool = True, features=FEATURE_NAMES, **overrides):
    params = dict(n_estimators=400, learning_rate=0.05, max_depth=6, subsample=0.8, colsample_bytree=0.8, min_child_weight=5,
                  reg_lambda=1.0, tree_method="hist", n_jobs=-1, random_state=seed)
    if monotone:
        params["monotone_constraints"] = monotone_constraints(features)
    return XGBRegressor(**{**params, **overrides})


MODEL_FACTORIES = {
    "mean": lambda seed: make_mean_baseline(),
    "ridge": lambda seed: make_ridge(),
    "random_forest": make_random_forest,
    "xgboost": lambda seed: make_xgboost(seed, monotone=False),
    "xgboost_monotone": lambda seed: make_xgboost(seed, monotone=True),
}
