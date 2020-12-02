import {AfterViewInit, Component, ViewChild} from '@angular/core';
import {RelicService} from '../relic.service';
import {MatPaginator} from '@angular/material/paginator';
import {MatSort} from '@angular/material/sort';
import {MatDialog, MatDialogConfig} from '@angular/material/dialog';
import {RadDialogComponent} from './raddialog/rad-dialog.component';
import {catchError, map, startWith, switchMap} from 'rxjs/operators';
import {merge, Observable, of} from 'rxjs';
import {MatTableDataSource} from '@angular/material/table';

export interface RadRoom {
  expirationDate?: number;
  relic: string;
  quality: string;
  platform: string;
  tenno: string;
  code?: string;
}

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css']
})
export class HomeComponent implements AfterViewInit{
  displayedColumns: string[] = ['relic', 'quality', 'platform', 'tenno', 'expirationDate'];
  private isLoadingResults: boolean;
  private resultsLength = 0;
  dataSource: MatTableDataSource<RadRoom[]>;

  @ViewChild(MatPaginator) paginator: MatPaginator;
  @ViewChild(MatSort) sort: MatSort;

  constructor(private relics: RelicService, private newRadDiaglog: MatDialog) {}

  ngAfterViewInit(){
    this.sort.sortChange.subscribe(() => this.paginator.pageIndex = 0);
    merge()
      .pipe(
        startWith({}),
        switchMap(() => {
          this.isLoadingResults = true;
          return this.loadRadshares();
        }),
        map(data => {
          // Flip flag to show that loading has finished.
          this.isLoadingResults = false;
          this.resultsLength = data.total_count;
          // Turn the expiration date from milliseconds to a displayable format
          data.data.forEach( (room) => {
            var totalMins = Math.round((room.expirationDate - Date.now()) / 1000 / 60);
            var mins = totalMins % 60;
            var hrs = Math.floor(totalMins / 60);
            room.expirationDate = hrs + ':' + mins.toString().padStart(2, '0');
          });
          return data.data;
        }),
        catchError((err) => {
          console.error(err);
          this.isLoadingResults = false;
          return of([]);
        })
      ).subscribe(data => {
        this.dataSource = new MatTableDataSource(data);
        this.dataSource.paginator = this.paginator;
        this.dataSource.sort = this.sort;
        console.log(this.dataSource.paginator);
        console.log(this.dataSource.sort);
    });
  }

  openNewRadDialog() {
    const dialogConfig = new MatDialogConfig();

    dialogConfig.autoFocus = true;
    this.newRadDiaglog.open(RadDialogComponent, dialogConfig);
  }

  loadRadshares(): Observable<any> {
    return this.relics.getRadshares();
  }

}
