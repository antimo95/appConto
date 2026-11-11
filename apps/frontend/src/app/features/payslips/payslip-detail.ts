import { Component, computed, input, output } from '@angular/core';
import { formatMonth } from '../../core/format';
import { Amount } from '@shared/ui/data/amount/amount';
import {
  KIND_LABELS,
  LEAVE_LABELS,
  SECTION_LABELS,
  centsToEuros,
  formatImportedAt,
  formatQuantity
} from './payslip-format';
import { payslipDocumentUrl } from './payslips.api';
import { PayslipDetail } from './payslip.model';

/** Il cedolino scelto, voce per voce, con le azioni su di esso. */
@Component({
  selector: 'app-payslip-detail',
  imports: [Amount],
  templateUrl: './payslip-detail.html',
  styleUrl: './payslip-detail.scss'
})
export class PayslipDetailView {
  readonly detail = input.required<PayslipDetail>();
  /** Un'altra richiesta è in corso: Modifica ed Elimina aspettano. */
  readonly busy = input(false);

  readonly edit = output<void>();
  readonly remove = output<void>();

  protected readonly formatMonth = formatMonth;
  protected readonly formatImportedAt = formatImportedAt;
  protected readonly formatQuantity = formatQuantity;
  protected readonly kindLabels = KIND_LABELS;
  protected readonly sectionLabels = SECTION_LABELS;
  protected readonly leaveLabels = LEAVE_LABELS;
  protected readonly euros = centsToEuros;

  protected readonly documentUrl = computed(() => payslipDocumentUrl(this.detail().id));
}
