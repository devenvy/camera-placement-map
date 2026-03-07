import { Component, inject, signal } from '@angular/core';
import { CameraService } from '../../services/camera.service';
import { CameraEditorComponent } from '../camera-editor/camera-editor';

@Component({
  selector: 'app-sidebar',
  imports: [CameraEditorComponent],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.css',
})
export class SidebarComponent {
  protected cameraService = inject(CameraService);
  protected collapsed = signal(false);

  protected toggleCollapse(): void {
    this.collapsed.update((v) => !v);
  }

  protected selectCamera(id: string): void {
    this.cameraService.selectCamera(id);
  }

  protected deleteCamera(id: string, event: Event): void {
    event.stopPropagation();
    this.cameraService.deleteCamera(id);
  }

  protected exportCameras(): void {
    const json = this.cameraService.exportToJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cameras-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  protected importCameras(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = this.cameraService.importFromJson(
        reader.result as string,
      );
      if (!result.success) {
        alert(`Import failed: ${result.error}`);
      }
    };
    reader.readAsText(file);
    input.value = '';
  }
}
