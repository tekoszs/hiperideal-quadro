import type { ValidationIssue } from '@/types/domain';

interface Props {
  issues: ValidationIssue[];
}

/** Lista exatamente quais funções estão pendentes — nada é enviado com pendência. */
export function ValidationSummary({ issues }: Props) {
  if (issues.length === 0) return null;

  return (
    <div className="alert alert--error" role="alert">
      <p className="alert__title">
        {issues.length === 1
          ? '1 pendência impede o envio:'
          : `${issues.length} pendências impedem o envio:`}
      </p>
      <ul className="alert__list">
        {issues.map((issue, index) => (
          <li className="alert__item" key={`${issue.code}-${issue.positionId}-${index}`}>
            {issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
