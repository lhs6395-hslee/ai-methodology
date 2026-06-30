import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// SDD 테스트 스위트 설정 (도메인 범용).
// 각 테스트는 검증하는 FR을 다음과 같이 태그한다:
//   // @covers <SPEC-ID>/FR-NNN
// → FR↔test 추적 게이트(scripts/check-fr-coverage.mjs)가 매핑한다.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "node", // DOM 필요 시 "jsdom"
    include: ["src/**/*.{test,spec}.{ts,tsx}", "tests/**/*.{test,spec}.{ts,tsx}"],
    coverage: { provider: "v8", reportsDirectory: "coverage" },
  },
});
