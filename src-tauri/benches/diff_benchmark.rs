use criterion::{black_box, criterion_group, criterion_main, Criterion, SamplingMode};
use diff_core::diff::myers_diff::diff_lines;
use std::env;
use std::time::Duration;

/// Generate test data of specified size
fn generate_lines(count: usize, variance: usize) -> Vec<String> {
    (0..count)
        .map(|i| {
            if i % variance == 0 {
                format!("CHANGED line {}", i)
            } else {
                format!("line {}", i)
            }
        })
        .collect()
}

fn diff_benchmark(c: &mut Criterion) {
    let mut group = c.benchmark_group("diff_performance");
    let profile = env::var("DIFF_BENCH_PROFILE").unwrap_or_else(|_| "quick".to_string());
    let is_stable = profile.eq_ignore_ascii_case("stable");
    let sample_size = if is_stable { 20 } else { 10 };
    let measurement_secs = if is_stable { 60 } else { 30 };

    group.sample_size(sample_size);
    group.measurement_time(Duration::from_secs(measurement_secs));
    if is_stable {
        group.sampling_mode(SamplingMode::Flat);
    }
    
    // Small file (10K lines)
    group.bench_function("10K_lines_10pct_change", |b| {
        let a = black_box(generate_lines(10_000, 10));
        let b_data = black_box(generate_lines(10_000, 11));
        b.iter(|| diff_lines(&a, &b_data))
    });
    
    // Medium file (50K lines)
    // ⚠️ NOTE: Uses direct Myers algorithm (no chunking)
    // Total lines = 100K, which does NOT exceed CHUNK_THRESHOLD (100K)
    group.bench_function("50K_lines_10pct_change", |b| {
        let a = black_box(generate_lines(50_000, 10));
        let b_data = black_box(generate_lines(50_000, 11));
        b.iter(|| diff_lines(&a, &b_data))
    });
    
    // Large file (100K lines)
    // ✅ Uses chunked algorithm for better cache locality!
    // Total lines = 200K > CHUNK_THRESHOLD (100K) → triggers chunked processing
    // Paradoxically faster than 50K because chunk-local processing benefits from cache
    group.bench_function("100K_lines_10pct_change", |b| {
        let a = black_box(generate_lines(100_000, 10));
        let b_data = black_box(generate_lines(100_000, 11));
        b.iter(|| diff_lines(&a, &b_data))
    });
    
    // Very large file (200K lines)
    // ✅ Uses chunked algorithm
    // Total lines = 400K > CHUNK_THRESHOLD (100K) → triggers chunked processing
    group.bench_function("200K_lines_10pct_change", |b| {
        let a = black_box(generate_lines(200_000, 10));
        let b_data = black_box(generate_lines(200_000, 11));
        b.iter(|| diff_lines(&a, &b_data))
    });
    
    // Pure additions
    group.bench_function("50K_pure_insert", |b| {
        let a = black_box(generate_lines(25_000, 1));
        let b_data = black_box(generate_lines(50_000, 1));
        b.iter(|| diff_lines(&a, &b_data))
    });
    
    // Pure deletions
    group.bench_function("50K_pure_delete", |b| {
        let a = black_box(generate_lines(50_000, 1));
        let b_data = black_box(generate_lines(25_000, 1));
        b.iter(|| diff_lines(&a, &b_data))
    });
    
    // Identical files (best case)
    group.bench_function("50K_identical", |b| {
        let a = black_box(generate_lines(50_000, 1));
        let b_data = black_box(a.clone());
        b.iter(|| diff_lines(&a, &b_data))
    });
    
    group.finish();
}

criterion_group!(benches, diff_benchmark);
criterion_main!(benches);
