import unittest

import numpy as np
import pandas as pd

from urbanheat_ml.cv import SPIKE_C, random_cv, regression_metrics, spatial_cv
from urbanheat_ml.features import FEATURE_NAMES
from urbanheat_ml.models import MODEL_FACTORIES, make_xgboost, monotone_constraints


class MetricsTest(unittest.TestCase):
    def test_known_values(self):
        y = np.array([0.0, 2.0, 4.0, 6.0])
        pred = np.array([1.0, 2.0, 3.0, 8.0])
        m = regression_metrics(y, pred)
        self.assertAlmostEqual(m["rmse"], np.sqrt((1 + 0 + 1 + 4) / 4))
        self.assertAlmostEqual(m["mae"], (1 + 0 + 1 + 2) / 4)
        self.assertAlmostEqual(m["bias"], (1 + 0 - 1 + 2) / 4)
        self.assertAlmostEqual(m["r2"], 1 - 6 / 20)
        self.assertEqual(m["n"], 4)

    def test_perfect_and_mean_predictions(self):
        y = np.linspace(-2, 9, 50)
        self.assertAlmostEqual(regression_metrics(y, y)["rmse"], 0.0)
        self.assertAlmostEqual(regression_metrics(y, y)["r2"], 1.0)
        self.assertAlmostEqual(regression_metrics(y, np.full_like(y, y.mean()))["r2"], 0.0)

    def test_spike_precision_recall(self):
        y = np.array([0, 1, 4, 5, 6, 2.0])           # spikes (> 3): 4, 5, 6
        pred = np.array([4, 0, 5, 1, 7, 2.0])        # predicted spikes: idx 0 (false), 2 (true), 4 (true)
        m = regression_metrics(y, pred)
        self.assertAlmostEqual(m["spike_precision"], 2 / 3)
        self.assertAlmostEqual(m["spike_recall"], 2 / 3)
        self.assertAlmostEqual(m["spike_f1"], 2 / 3)
        self.assertAlmostEqual(m["spike_share"], 0.5)
        none = regression_metrics(np.array([0.0, 1.0]), np.array([0.5, 0.5]))
        self.assertTrue(np.isnan(none["spike_precision"]) and np.isnan(none["spike_recall"]))
        self.assertEqual(SPIKE_C, 3.0)


def toy(n_blocks=20, per_block=40, seed=0):
    """Spatially autocorrelated toy data: a block-level latent (invisible to the models) plus a real feature effect."""
    rng = np.random.default_rng(seed)
    block = np.repeat(np.arange(n_blocks), per_block)
    latent = rng.normal(0, 2.0, n_blocks)[block]                       # shared within a block -> neighbours look alike
    imp = rng.uniform(0, 100, len(block))
    canopy = rng.uniform(0, 100, len(block))
    df = pd.DataFrame({f: rng.uniform(0, 1, len(block)) for f in FEATURE_NAMES})
    df["impervious_pct"], df["canopy_pct"] = imp, canopy
    df["block_id"] = block
    df["fold"] = block % 4
    df["y"] = 0.05 * imp - 0.03 * canopy + latent + rng.normal(0, 0.2, len(block))
    return df


class CvTest(unittest.TestCase):
    def setUp(self):
        self.df = toy()
        self.features = list(FEATURE_NAMES)

    def test_every_row_is_held_out_exactly_once_and_folds_are_respected(self):
        r = spatial_cv(self.df, self.features, "y", MODEL_FACTORIES["ridge"])
        self.assertFalse(np.isnan(r["oof"]).any())
        self.assertEqual(r["pooled"]["n"], len(self.df))
        self.assertEqual([f["n"] for f in r["per_fold"]], [int((self.df.fold == k).sum()) for k in range(4)])

    def test_spatial_cv_is_not_more_optimistic_than_random_cv_when_neighbours_are_alike(self):
        # A flexible model with access to a block-identifying feature memorises blocks; random CV rewards that, spatial CV does not.
        df = self.df.copy()
        df["elevation_m"] = df.block_id.astype(float)            # a place-identifying proxy
        spatial = spatial_cv(df, self.features, "y", MODEL_FACTORIES["random_forest"])
        shuffled = random_cv(df, self.features, "y", MODEL_FACTORIES["random_forest"])
        self.assertLess(shuffled["pooled"]["rmse"], spatial["pooled"]["rmse"] * 0.8,
                        f"random {shuffled['pooled']['rmse']:.3f} vs spatial {spatial['pooled']['rmse']:.3f}")

    def test_mean_baseline_has_zero_r2_ish_and_ridge_beats_it(self):
        base = spatial_cv(self.df, self.features, "y", MODEL_FACTORIES["mean"])
        ridge = spatial_cv(self.df, self.features, "y", MODEL_FACTORIES["ridge"])
        self.assertLess(base["pooled"]["r2"], 0.05)
        self.assertGreater(ridge["pooled"]["r2"], 0.2)
        self.assertLess(ridge["pooled"]["rmse"], base["pooled"]["rmse"])


class ModelsTest(unittest.TestCase):
    def test_monotone_constraints_follow_the_feature_names(self):
        c = monotone_constraints()
        self.assertEqual(len(c), len(FEATURE_NAMES))
        for name, k in zip(FEATURE_NAMES, c):
            self.assertEqual(k, -1 if name.startswith("canopy") else 1 if name.startswith("impervious") else 0, name)
        self.assertNotIn(1, [k for n, k in zip(FEATURE_NAMES, c) if n.startswith("canopy")])

    def test_monotone_xgboost_never_gets_hotter_with_more_canopy(self):
        rng = np.random.default_rng(1)
        X = rng.uniform(0, 100, (800, len(FEATURE_NAMES))).astype("float32")
        y = -0.05 * X[:, 0] + 0.04 * X[:, 1] + rng.normal(0, 3, 800)     # noisy so an unconstrained model could wiggle
        m = make_xgboost(1, monotone=True, n_estimators=80).fit(X, y)
        base = X[:200].copy()
        for j in (i for i, n in enumerate(FEATURE_NAMES) if n.startswith("canopy")):
            lo, hi = base.copy(), base.copy()
            hi[:, j] = lo[:, j] + 30
            self.assertTrue(np.all(m.predict(hi) <= m.predict(lo) + 1e-6), FEATURE_NAMES[j])
        for j in (i for i, n in enumerate(FEATURE_NAMES) if n.startswith("impervious")):
            lo, hi = base.copy(), base.copy()
            hi[:, j] = lo[:, j] + 30
            self.assertTrue(np.all(m.predict(hi) >= m.predict(lo) - 1e-6), FEATURE_NAMES[j])


if __name__ == "__main__":
    unittest.main()
