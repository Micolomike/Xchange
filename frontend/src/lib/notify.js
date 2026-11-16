import Swal from 'sweetalert2';

const toastMixin = Swal.mixin({
  toast: true,
  position: 'bottom-end',
  showConfirmButton: false,
  timer: 3200,
  timerProgressBar: false,
});

export function toast(title, icon = 'success') {
  return toastMixin.fire({ icon, title });
}

export function toastError(error) {
  return toastMixin.fire({ icon: 'error', title: error?.message || String(error), timer: 5000 });
}

/** Confirmation avant une action ; renvoie true si l'utilisateur valide. */
export async function confirmAction({ title, text, confirmText, danger = false }) {
  const result = await Swal.fire({
    title,
    text,
    icon: danger ? 'warning' : 'question',
    showCancelButton: true,
    confirmButtonText: confirmText,
    cancelButtonText: 'Annuler',
    reverseButtons: true,
    focusCancel: danger,
    confirmButtonColor: danger ? '#c22f2f' : '#2f4bd8',
    cancelButtonColor: '#5b6573',
  });
  return result.isConfirmed;
}

export function showInfo({ title, html, icon = 'info' }) {
  return Swal.fire({ title, html, icon, confirmButtonText: 'Fermer', confirmButtonColor: '#2f4bd8' });
}
