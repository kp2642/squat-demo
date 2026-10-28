import type { IndustryPreset } from '@/lib/presets';

export type WorkspaceDraft = { workspaceName?: string; industry?: string; domains?: string; name?: string };

// 가입 화면과 사업장 만들기 화면이 같이 쓰는 입력칸
export function WorkspaceFields({ presets, draft }: { presets: IndustryPreset[]; draft: WorkspaceDraft }) {
  return (
    <>
      <label htmlFor="name">내 이름</label>
      <input id="name" name="name" autoComplete="name" defaultValue={draft.name} maxLength={50} />
      <label htmlFor="workspace_name">사업장 이름</label>
      <input id="workspace_name" name="workspace_name" defaultValue={draft.workspaceName} placeholder="예: 바른 법률사무소" maxLength={100} required />
      <label htmlFor="industry">
        업종 <span className="hint">계약 용어·상담 유형·평균 계약 금액이 채워져요. 나중에 바꿀 수 있어요.</span>
      </label>
      <select id="industry" name="industry" defaultValue={draft.industry ?? presets[0]?.key} required>
        {presets.map((p) => (
          <option key={p.key} value={p.key}>
            {p.name} ({p.contract_term} · 평균 {p.avg_contract_amount.toLocaleString('ko-KR')}원)
          </option>
        ))}
      </select>
      <label htmlFor="domains">
        홈페이지 주소 <span className="hint">여러 개면 한 줄에 하나씩</span>
      </label>
      <textarea id="domains" name="domains" defaultValue={draft.domains} placeholder="https://www.example.com" />
    </>
  );
}
