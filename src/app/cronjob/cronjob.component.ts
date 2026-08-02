import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

interface WorkflowRun {
  id: number;
  status: string;
  conclusion: string | null;
  created_at: string;
  updated_at: string;
  html_url: string;
}

@Component({
  selector: 'app-cronjob',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './cronjob.component.html'
})
export class CronjobComponent implements OnInit {
  githubToken: string = '';
  runs: WorkflowRun[] = [];
  loading: boolean = false;
  triggering: boolean = false;
  errorMessage: string = '';
  successMessage: string = '';

  private readonly repoOwner = 'LienHuynh04';
  private readonly repoName = 'an-upharma';
  private readonly workflowId = 'deploy.yml';
  private readonly tokenKey = 'upharma_github_pat';

  ngOnInit() {
    const savedToken = localStorage.getItem(this.tokenKey);
    if (savedToken) {
      this.githubToken = savedToken;
      this.fetchRuns();
    }
  }

  saveToken() {
    if (!this.githubToken) {
      this.errorMessage = 'Vui lòng nhập GitHub Token';
      return;
    }
    localStorage.setItem(this.tokenKey, this.githubToken);
    this.successMessage = 'Đã lưu Token thành công!';
    this.errorMessage = '';
    this.fetchRuns();
  }

  clearToken() {
    this.githubToken = '';
    localStorage.removeItem(this.tokenKey);
    this.runs = [];
    this.successMessage = 'Đã xóa Token!';
  }

  async fetchRuns() {
    if (!this.githubToken) return;
    this.loading = true;
    this.errorMessage = '';
    try {
      const response = await fetch(`https://api.github.com/repos/${this.repoOwner}/${this.repoName}/actions/workflows/${this.workflowId}/runs?per_page=10`, {
        headers: {
          'Authorization': `Bearer ${this.githubToken}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      
      if (!response.ok) {
        if (response.status === 401) throw new Error('Token không hợp lệ hoặc đã hết hạn.');
        throw new Error(`Lỗi gọi API: ${response.statusText}`);
      }
      
      const data = await response.json();
      this.runs = data.workflow_runs || [];
    } catch (error: any) {
      this.errorMessage = error.message;
    } finally {
      this.loading = false;
    }
  }

  async triggerWorkflow() {
    if (!this.githubToken) {
      this.errorMessage = 'Cần lưu Token trước khi chạy!';
      return;
    }
    
    this.triggering = true;
    this.errorMessage = '';
    this.successMessage = '';
    
    try {
      const response = await fetch(`https://api.github.com/repos/${this.repoOwner}/${this.repoName}/actions/workflows/${this.workflowId}/dispatches`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ref: 'master' })
      });
      
      if (!response.ok) {
        throw new Error(`Lỗi kích hoạt: ${response.statusText}`);
      }
      
      this.successMessage = 'Đã gửi lệnh chạy Cronjob thành công! Đang tải lại danh sách...';
      
      // Chờ 3 giây rồi tải lại danh sách để hiện action mới
      setTimeout(() => this.fetchRuns(), 3000);
      
    } catch (error: any) {
      this.errorMessage = error.message;
    } finally {
      this.triggering = false;
    }
  }

  formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleString('vi-VN');
  }

  getStatusClass(run: WorkflowRun): string {
    if (run.status === 'in_progress' || run.status === 'queued') return 'status-running';
    if (run.conclusion === 'success') return 'status-success';
    if (run.conclusion === 'failure') return 'status-error';
    return 'status-other';
  }
  
  getStatusLabel(run: WorkflowRun): string {
    if (run.status === 'queued') return '⏳ Đang chờ...';
    if (run.status === 'in_progress') return '🔄 Đang chạy...';
    if (run.conclusion === 'success') return '✅ Thành công';
    if (run.conclusion === 'failure') return '❌ Thất bại';
    if (run.conclusion === 'cancelled') return '⛔ Đã hủy';
    return `❔ ${run.status}`;
  }
}
