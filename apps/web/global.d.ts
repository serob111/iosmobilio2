import en from "./messages/en.json";

type Messages = typeof en;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- next-intl's documented augmentation pattern
  interface IntlMessages extends Messages {}
}
