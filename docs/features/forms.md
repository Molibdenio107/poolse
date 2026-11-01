# Forms: saying what is wrong — 1 November 2026

> "When filling in a student details form, it says error, but it doesn't specify what's mandatory or
> missing … apply this rule to every other form throughout the app." — Rui, 01-11-2026

Every form in the app follows the same three rules, from shared code, so a new form gets them by
using the shared fields.

1. **A required field says so before anything is sent.** `TextField`, `TextAreaField` and
   `SelectField` (`components/ui/field.tsx`) put a `*` after the label of a `required` control. The
   control's own `required` is what a screen reader announces.
2. **A refusal is said under the field it concerns.** When the browser judges a control invalid
   (empty and required, a malformed email, out of range), the field shows its own sentence underneath
   (`common.validation.*`: *Campo obrigatório.*, *O formato não é válido.*, …) instead of the browser's
   bubble, and the sentence clears as soon as the field is edited. A message from the server, when
   there is one, wins. A hand-built control gets the same sentence from `FormValidation`, placed after
   it and removed on its next edit.
3. **The toast says what is wrong, not that something is.** `FormValidation`
   (`components/form-validation.tsx`, mounted once in the app's root layout) gathers every invalid
   control of one submit and raises one toast naming them by label (*Corrija os campos assinalados:
   Nome próprio, Apelido.*), then focuses the first. A server refusal that names fields adds those
   fields' own sentences to the toast (`useSavedAction`), never just "check the fields".

The words come from the catalogue through `ValidationMessagesProvider`, which the app layout fills.
Public pages translate on the server and have no intl provider; their forms use `noValidate`, so
the server's field errors are what show there.

**An action that refuses a value names the field** (`fields: { name: key }`) as well as giving the
sentence (`errorKey`). The student form's missing names are the model: `students.nameRequired` in
the toast and `common.validation.required` under each empty name.
