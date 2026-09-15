import { describe, expect, it } from "vitest";

import {
  hashAllowedEmail as hashFromProvisioner,
  normalizeEmail as normalizeFromProvisioner,
} from "../src/auth/provision-field-user.js";
import {
  DEFAULT_DATABASE_URL,
  DEFAULT_PROJECT_ID,
  FieldAccountSetupError,
  buildPlan,
  hashAllowedEmail,
  normalizeEmail,
  parseArgs,
  runBootstrap,
  runCli,
} from "../scripts/bootstrap-field-account.mjs";

function collector() {
  const lines: string[] = [];
  return { lines, writeLine: (line: string) => lines.push(line) };
}

function recordingDependencies(uid: string | null = "uid-1") {
  const writes: Array<{ path: string; value: Record<string, unknown> }> = [];
  const claims: Array<{ uid: string; value: Record<string, unknown> }> = [];
  return {
    writes,
    claims,
    lookupUid: async () => uid,
    setCustomClaims: async (id: string, value: Record<string, unknown>) => {
      claims.push({ uid: id, value });
    },
    write: async (path: string, value: Record<string, unknown>) => {
      writes.push({ path, value });
    },
    now: () => 1_700_000_000_000,
  };
}

describe("bootstrap-field-account 해시", () => {
  // 이 스크립트가 쓰는 위치와 provisionFieldUser 가 읽는 위치가 어긋나면
  // 등록해도 로그인이 안 됩니다. 두 구현을 직접 맞대어 봅니다.
  const samples = [
    "bringengineering1008@gmail.com",
    "  Mixed.Case@Example.COM  ",
    "staff+tag@bring.co.kr",
  ];

  it("provisionFieldUser 의 해시와 정확히 같다", () => {
    for (const sample of samples) {
      expect(hashAllowedEmail(sample)).toBe(hashFromProvisioner(sample));
      expect(normalizeEmail(sample)).toBe(normalizeFromProvisioner(sample));
    }
  });

  it("대소문자와 공백을 정규화한다", () => {
    expect(hashAllowedEmail(" A@B.com ")).toBe(hashAllowedEmail("a@b.com"));
  });
});

describe("parseArgs", () => {
  it("기본값은 allowlist 모드, admin 역할, 확인 전 상태다", () => {
    const parsed = parseArgs(["--email=a@b.com"]);
    expect(parsed).toMatchObject({
      email: "a@b.com",
      role: "admin",
      mode: "allowlist",
      databaseURL: DEFAULT_DATABASE_URL,
      projectId: DEFAULT_PROJECT_ID,
      confirmed: false,
    });
  });

  it("--yes 를 붙여야 confirmed 가 된다", () => {
    expect(parseArgs(["--email=a@b.com", "--yes"]).confirmed).toBe(true);
  });

  it.each([
    [["--email=not-an-email"], "email_invalid"],
    [[], "email_invalid"],
    [["--email=a@b.com", "--role=owner"], "role_invalid"],
    [["--email=a@b.com", "--mode=delete"], "mode_invalid"],
    [["--email=a@b.com", "--unknown=1"], "argument_unexpected"],
    [["--email=a@b.com", "positional"], "argument_unexpected"],
    [["--email=a@b.com", "--email=c@d.com"], "argument_duplicated"],
  ])("%j 를 거부한다", (argv, code) => {
    expect(() => parseArgs(argv as string[])).toThrowError(
      expect.objectContaining({ code }) as unknown as Error,
    );
  });
});

describe("buildPlan", () => {
  it("allowlist 모드는 허용 목록만 쓰고 uid 를 요구하지 않는다", () => {
    const plan = buildPlan({ email: "a@b.com", role: "staff", mode: "allowlist" });
    expect(plan.needsUid).toBe(false);
    expect(plan.claims).toBeNull();
    expect(plan.writes).toHaveLength(1);
    expect(plan.writes[0]).toEqual({
      path: `fieldPlatformAllowedEmails/${hashAllowedEmail("a@b.com")}`,
      value: { active: true, role: "staff" },
    });
  });

  it("provision 모드는 클레임과 사용자 레코드까지 만든다", () => {
    const plan = buildPlan({ email: "a@b.com", role: "admin", mode: "provision", uid: "u1" });
    expect(plan.writes.map((w) => w.path)).toEqual([
      `fieldPlatformAllowedEmails/${hashAllowedEmail("a@b.com")}`,
      "fieldPlatform/users/u1",
    ]);
    expect(plan.writes[1].value).toEqual({ role: "admin", enabled: true });
    expect(plan.claims).toEqual({
      uid: "u1",
      value: { fieldPlatform: true, fieldRole: "admin" },
    });
  });

  it("revoke 모드는 켜는 값을 모두 끈다", () => {
    const plan = buildPlan({ email: "a@b.com", role: "staff", mode: "revoke", uid: "u1" });
    expect(plan.writes[0].value).toEqual({ active: false, role: "staff" });
    expect(plan.writes[1].value).toEqual({ role: "staff", enabled: false });
    expect(plan.claims?.value).toEqual({ fieldPlatform: null, fieldRole: null });
  });

  it("uid 없이 provision 하려 하면 거부한다", () => {
    expect(() => buildPlan({ email: "a@b.com", role: "admin", mode: "provision" }))
      .toThrowError(FieldAccountSetupError);
  });
});

describe("runBootstrap", () => {
  it("--yes 가 없으면 아무것도 쓰지 않는다", async () => {
    const deps = recordingDependencies();
    const out = collector();
    const result = await runBootstrap({
      email: "a@b.com",
      role: "admin",
      mode: "provision",
      projectId: "bring-fm",
      confirmed: false,
      ...deps,
      writeLine: out.writeLine,
    });

    expect(result.applied).toBe(false);
    expect(deps.writes).toEqual([]);
    expect(deps.claims).toEqual([]);
    expect(out.lines.join("\n")).toContain("--yes");
  });

  it("확인하면 계획한 그대로 쓴다", async () => {
    const deps = recordingDependencies();
    const out = collector();
    await runBootstrap({
      email: "a@b.com",
      role: "admin",
      mode: "provision",
      projectId: "bring-fm",
      confirmed: true,
      ...deps,
      writeLine: out.writeLine,
    });

    expect(deps.writes).toEqual([
      {
        path: `fieldPlatformAllowedEmails/${hashAllowedEmail("a@b.com")}`,
        value: { active: true, role: "admin", updatedAt: 1_700_000_000_000 },
      },
      {
        path: "fieldPlatform/users/uid-1",
        value: { role: "admin", enabled: true, updatedAt: 1_700_000_000_000 },
      },
    ]);
    expect(deps.claims).toEqual([
      { uid: "uid-1", value: { fieldPlatform: true, fieldRole: "admin" } },
    ]);
  });

  it("allowlist 모드는 로그인 기록이 없어도 동작한다", async () => {
    const deps = recordingDependencies(null);
    const out = collector();
    await runBootstrap({
      email: "a@b.com",
      role: "admin",
      mode: "allowlist",
      projectId: "bring-fm",
      confirmed: true,
      ...deps,
      writeLine: out.writeLine,
    });

    expect(deps.writes).toHaveLength(1);
    expect(deps.claims).toEqual([]);
  });

  it("provision 인데 로그인 기록이 없으면 이유를 알려준다", async () => {
    const deps = recordingDependencies(null);
    await expect(runBootstrap({
      email: "a@b.com",
      role: "admin",
      mode: "provision",
      projectId: "bring-fm",
      confirmed: true,
      ...deps,
      writeLine: collector().writeLine,
    })).rejects.toThrowError(expect.objectContaining({ code: "auth_user_not_found" }) as unknown as Error);
    expect(deps.writes).toEqual([]);
  });

  it("계획 출력은 실제로 쓰는 경로를 그대로 보여준다", async () => {
    const deps = recordingDependencies();
    const out = collector();
    await runBootstrap({
      email: "a@b.com",
      role: "admin",
      mode: "provision",
      projectId: "bring-fm",
      confirmed: true,
      ...deps,
      writeLine: out.writeLine,
    });
    const printed = out.lines.join("\n");
    for (const write of deps.writes) {
      expect(printed).toContain(write.path);
    }
  });
});

describe("runCli", () => {
  it("잘못된 인자는 0이 아닌 코드로 끝난다", async () => {
    const errors: string[] = [];
    const code = await runCli({
      argv: ["--email=nope"],
      writeLine: () => {},
      writeError: (line: string) => errors.push(line),
    });
    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("이메일");
  });

  it("성공하면 0으로 끝난다", async () => {
    const code = await runCli({
      argv: ["--email=a@b.com", "--yes"],
      dependencies: recordingDependencies(),
      writeLine: () => {},
      writeError: () => {},
    });
    expect(code).toBe(0);
  });
});

describe("자격증명 확인", () => {
  it("쓰기 전에 먼저 자격증명을 확인한다", async () => {
    const deps = recordingDependencies();
    const order: string[] = [];
    await runBootstrap({
      email: "a@b.com",
      role: "admin",
      mode: "provision",
      projectId: "bring-fm",
      confirmed: true,
      ...deps,
      verify: async () => { order.push("verify"); },
      write: async (path: string) => { order.push(`write:${path}`); },
      writeLine: () => {},
    });
    expect(order[0]).toBe("verify");
  });

  it("자격증명이 없으면 아무것도 쓰지 않고 멈춘다", async () => {
    const deps = recordingDependencies();
    await expect(runBootstrap({
      email: "a@b.com",
      role: "admin",
      mode: "provision",
      projectId: "bring-fm",
      confirmed: true,
      ...deps,
      verify: async () => {
        throw new FieldAccountSetupError("credentials_missing");
      },
      writeLine: () => {},
    })).rejects.toThrowError(
      expect.objectContaining({ code: "credentials_missing" }) as unknown as Error,
    );
    expect(deps.writes).toEqual([]);
  });

  it("확인만 할 때는 자격증명을 요구하지 않는다", async () => {
    const deps = recordingDependencies();
    let verified = false;
    const result = await runBootstrap({
      email: "a@b.com",
      role: "admin",
      mode: "allowlist",
      projectId: "bring-fm",
      confirmed: false,
      ...deps,
      verify: async () => { verified = true; },
      writeLine: () => {},
    });
    expect(result.applied).toBe(false);
    expect(verified).toBe(false);
  });

  it("작업이 끝나면 연결을 정리한다", async () => {
    let disposed = false;
    const code = await runCli({
      argv: ["--email=a@b.com", "--yes"],
      dependencies: { ...recordingDependencies(), dispose: async () => { disposed = true; } },
      writeLine: () => {},
      writeError: () => {},
    });
    expect(code).toBe(0);
    expect(disposed).toBe(true);
  });

  it("실패해도 연결을 정리한다", async () => {
    let disposed = false;
    const code = await runCli({
      argv: ["--email=a@b.com", "--mode=provision", "--yes"],
      dependencies: {
        ...recordingDependencies(null),
        dispose: async () => { disposed = true; },
      },
      writeLine: () => {},
      writeError: () => {},
    });
    expect(code).toBe(1);
    expect(disposed).toBe(true);
  });
});
