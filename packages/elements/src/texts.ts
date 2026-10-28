/** Every string the elements show. Pass a partial object to override any of them. */
export interface RipenTexts {
  pickerTitle: string;
  expectsTelemetry: string;
  /** `{days}` is replaced with the number of days. */
  expectsPulse: string;
  expectsNothing: string;
  consentLabel: string;
  join: string;
  current: string;
  /** `{from}` and `{reason}` are replaced. */
  demoted: string;
  saved: string;
  feedbackQuestion: string;
  works: string;
  broken: string;
  reportPlaceholder: string;
  send: string;
  skip: string;
  thanks: string;
  failed: string;
  loading: string;
}

export const EN: RipenTexts = {
  pickerTitle: 'How early do you want new features?',
  expectsTelemetry: 'Errors are sent automatically',
  expectsPulse: 'A one-tap check-in every {days} days',
  expectsNothing: 'Nothing is expected from you',
  consentLabel: 'I agree that errors in the app are sent automatically to help fix them',
  join: 'Join',
  current: 'current',
  demoted: 'You were moved from "{from}": {reason}. You can rejoin at any time.',
  saved: 'Saved',
  feedbackQuestion: 'How does the app work for you after the update?',
  works: 'Everything works',
  broken: 'Something broke',
  reportPlaceholder: 'What broke? Optional, but it helps a lot.',
  send: 'Send',
  skip: 'Skip',
  thanks: 'Thank you!',
  failed: 'Could not send. Please try again.',
  loading: 'Loading…',
};

export const RU: RipenTexts = {
  pickerTitle: 'Насколько рано вы хотите получать новые функции?',
  expectsTelemetry: 'Ошибки отправляются автоматически',
  expectsPulse: 'Отметка в один клик раз в {days} дн.',
  expectsNothing: 'От вас ничего не требуется',
  consentLabel: 'Согласен, чтобы ошибки в приложении автоматически отправлялись для исправления',
  join: 'Перейти',
  current: 'сейчас',
  demoted: 'Вы перемещены из канала «{from}»: {reason}. Вернуться можно в любой момент.',
  saved: 'Сохранено',
  feedbackQuestion: 'Как работает приложение после обновления?',
  works: 'Всё работает',
  broken: 'Что-то сломалось',
  reportPlaceholder: 'Что сломалось? Необязательно, но очень поможет.',
  send: 'Отправить',
  skip: 'Пропустить',
  thanks: 'Спасибо!',
  failed: 'Не удалось отправить. Попробуйте ещё раз.',
  loading: 'Загрузка…',
};

export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}
