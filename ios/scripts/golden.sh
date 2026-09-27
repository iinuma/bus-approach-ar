#!/bin/sh
# TypeScript 版（../src/core）で入力と正解を作り、Swift 版のテストで突き合わせる。
set -eu
cd "$(dirname "$0")/../.."
npx tsx ios/scripts/golden.ts
