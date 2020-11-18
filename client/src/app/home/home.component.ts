import {AfterViewInit, Component, OnInit, ViewChild} from '@angular/core';
import {RelicService} from '../relic.service';
import {MatPaginator} from '@angular/material/paginator';
import {MatSort} from '@angular/material/sort';
import {MatTableDataSource} from '@angular/material/table';
import {MatDialog, MatDialogConfig} from '@angular/material/dialog';
import {RadDialogComponent} from './raddialog/rad-dialog.component';

export interface RadRoom {
  relic: string;
  quality: string;
  platform: string;
  tenno: string;
  deadline: string;
}

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.css']
})
export class HomeComponent implements AfterViewInit {
  displayedColumns: string[] = ['relic', 'quality', 'platform', 'tenno', 'deadline'];
  dataSource: MatTableDataSource<RadRoom>;

  @ViewChild(MatPaginator) paginator: MatPaginator;
  @ViewChild(MatSort) sort: MatSort;

  constructor(private relics: RelicService, private newRadDiaglog: MatDialog) {
    this.dataSource = new MatTableDataSource([
      {relic: 'MESO G1', quality: 'Radiant', platform: 'PC', tenno: '1', deadline: '???'},
      {relic: 'NEO N1', quality: 'Radiant', platform: 'PC', tenno: '3', deadline: '???'},
      {relic: 'NEO N2', quality: 'Intact', platform: 'Switch', tenno: '4', deadline: '???'}
      ])
  }

  ngAfterViewInit(){
    this.dataSource.paginator = this.paginator;
    this.dataSource.sort = this.sort;
  }

  openNewRadDialog() {
    const dialogConfig = new MatDialogConfig();

    dialogConfig.autoFocus = true;
    this.newRadDiaglog.open(RadDialogComponent, dialogConfig);
  }

  loadRadshares(){
    this.relics.getRadshares().subscribe(

    );
  }

}
